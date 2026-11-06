import { HttpStatus, Injectable, StreamableFile } from '@nestjs/common';
import type { GroupImportDto } from '@sru/shared-types';
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import type { AuthUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import type { RequestMeta } from '../common/decorators';
import { AppError, Errors } from '../common/errors';
import { GroupImportRowStatus, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Cell, CORE_COLUMNS, MAX_IMPORT_ROWS, ParsedMember, parseMemberRows, templateHeaders } from './group-import';
import { GroupsService, MEMBER_STATUSES } from './groups.service';

const MAX_BYTES = 5_000_000;

/** Excel import of members into a DRAFT group: upload → validate & preview → commit valid rows. */
@Injectable()
export class GroupImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly groups: GroupsService,
  ) {}

  async template(groupId: string, user: AuthUser) {
    const g = await this.groups.loadForCoordinator(groupId, user);
    const [fields, types] = await Promise.all([this.groups.fields(groupId), this.groups.participantTypes(g.eventId)]);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'SRU Event Hub';
    const ws = wb.addWorksheet('รายชื่อสมาชิก');
    const header = ws.addRow(templateHeaders({ fields, participantTypes: types }));
    header.font = { bold: true, name: 'Sarabun' };
    ws.columns.forEach((c) => (c.width = 22));
    // Phone numbers as text so Excel keeps the leading 0.
    ws.getColumn(CORE_COLUMNS.findIndex((c) => c.key === 'phone') + 1).numFmt = '@';
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const help = wb.addWorksheet('คำอธิบาย');
    help.addRow(['คอลัมน์ที่มี * จำเป็นต้องกรอก · หนึ่งแถวต่อสมาชิกหนึ่งคน · อีเมลห้ามซ้ำ']).font = { bold: true, name: 'Sarabun' };
    help.addRow([]);
    help.addRow(['ประเภทผู้เข้าร่วม (ใส่ชื่อหรือรหัส)']).font = { bold: true, name: 'Sarabun' };
    types.forEach((t) => help.addRow([t.nameTh, t.code]));
    for (const f of fields.filter((x) => x.options.length)) {
      help.addRow([]);
      const multi = f.fieldType === 'MULTISELECT' || f.fieldType === 'CHECKBOX';
      help.addRow([`${f.labelTh}${multi ? ' (เลือกได้หลายข้อ คั่นด้วย ,)' : ''}`]).font = { bold: true, name: 'Sarabun' };
      f.options.forEach((o) => help.addRow([o.labelTh, o.value]));
    }
    help.getColumn(1).width = 50;
    help.getColumn(2).width = 20;
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    return new StreamableFile(buf, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="group-members-template.xlsx"`,
    });
  }

  async upload(groupId: string, file: { buffer: Buffer; originalname: string } | undefined, user: AuthUser, meta: RequestMeta): Promise<GroupImportDto> {
    const g = await this.groups.loadForCoordinator(groupId, user);
    if (g.status !== 'DRAFT') throw Errors.invalidState('นำเข้ารายชื่อได้เฉพาะก่อนส่งกลุ่ม (หลังส่งให้เพิ่มสมาชิกทีละคน)');
    const s = await this.prisma.eventGroupSetting.findUnique({ where: { eventId: g.eventId } });
    if (!s?.isEnabled || !s.allowImport) throw Errors.conflict('IMPORT_DISABLED', 'กิจกรรมนี้ไม่อนุญาตการนำเข้ารายชื่อจาก Excel');
    if (!file?.buffer?.length) throw new AppError('FILE_REQUIRED', 'กรุณาแนบไฟล์ Excel', HttpStatus.BAD_REQUEST);
    if (file.buffer.length > MAX_BYTES) throw new AppError('FILE_TOO_LARGE', 'ไฟล์มีขนาดเกิน 5 MB', HttpStatus.PAYLOAD_TOO_LARGE);

    const rows = await this.readRows(file.buffer);
    if (rows.length - 1 > MAX_IMPORT_ROWS) throw Errors.validation(`นำเข้าได้ครั้งละไม่เกิน ${MAX_IMPORT_ROWS} แถว`);
    const [fields, types] = await Promise.all([this.groups.fields(groupId), this.groups.participantTypes(g.eventId)]);
    const parsed = parseMemberRows(rows, { fields, participantTypes: types });
    if (parsed.headerErrors.length) throw Errors.validation('รูปแบบไฟล์ไม่ตรงกับแม่แบบ', { header: parsed.headerErrors.join(', ') });
    if (!parsed.rows.length) throw Errors.validation('ไม่พบรายชื่อในไฟล์');

    // Cross-checks the pure parser cannot do: already in this group / already registered in the event.
    const emails = parsed.rows.filter((r) => r.member).map((r) => r.member!.email.toLowerCase());
    const taken = await this.prisma.registration.findMany({
      where: {
        emailNormalized: { in: emails },
        OR: [{ groupId, status: { in: MEMBER_STATUSES } }, { eventId: g.eventId, status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'WAITLISTED'] } }],
      },
      select: { emailNormalized: true, groupId: true },
    });
    const takenMap = new Map(taken.map((t) => [t.emailNormalized, t.groupId === groupId ? 'อยู่ในกลุ่มนี้แล้ว' : 'ลงทะเบียนกิจกรรมนี้ไว้แล้ว']));
    for (const r of parsed.rows) {
      const why = r.member && takenMap.get(r.member.email.toLowerCase());
      if (why) {
        r.errors = { ...(r.errors ?? {}), อีเมล: why };
        r.member = null;
      }
    }
    const valid = parsed.rows.filter((r) => r.member).length;
    const imp = await this.prisma.groupImport.create({
      data: {
        groupId,
        fileName: (file.originalname || 'import.xlsx').slice(0, 300),
        fileSha256: createHash('sha256').update(file.buffer).digest('hex'),
        totalRows: parsed.rows.length,
        validRows: valid,
        invalidRows: parsed.rows.length - valid,
        createdById: user.id,
        rows: {
          create: parsed.rows.map((r) => ({
            rowNo: r.rowNo,
            data: { ...r.data, ...(r.member ? { _member: r.member } : {}) } as unknown as Prisma.InputJsonValue,
            errors: r.errors ? (r.errors as Prisma.InputJsonValue) : Prisma.DbNull,
            status: (r.member ? 'VALID' : 'INVALID') as GroupImportRowStatus,
          })),
        },
      },
    });
    await this.audit.log({ actorId: user.id, action: 'group.import_upload', entityType: 'registration_group', entityId: groupId, after: { importId: imp.id, total: imp.totalRows, valid }, meta });
    return this.get(groupId, imp.id, user);
  }

  async get(groupId: string, importId: string, user: AuthUser): Promise<GroupImportDto> {
    await this.groups.loadForCoordinator(groupId, user);
    const imp = await this.prisma.groupImport.findFirst({ where: { id: importId, groupId }, include: { rows: { orderBy: { rowNo: 'asc' } } } });
    if (!imp) throw Errors.notFound('รายการนำเข้า');
    return {
      id: imp.id,
      fileName: imp.fileName,
      status: imp.status,
      totalRows: imp.totalRows,
      validRows: imp.validRows,
      invalidRows: imp.invalidRows,
      createdAt: imp.createdAt.toISOString(),
      committedAt: imp.committedAt?.toISOString() ?? null,
      rows: imp.rows.map((r) => {
        const { _member, ...data } = r.data as Record<string, unknown>;
        void _member;
        return { rowNo: r.rowNo, status: r.status, data: data as Record<string, string>, errors: r.errors as Record<string, string> | null };
      }),
    };
  }

  /** Adds every VALID row as a DRAFT member, in one transaction (all rows or none). */
  async commit(groupId: string, importId: string, user: AuthUser, meta: RequestMeta) {
    await this.groups.loadForCoordinator(groupId, user);
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM group_imports WHERE id = ${importId}::uuid FOR UPDATE`;
        const imp = await tx.groupImport.findFirst({ where: { id: importId, groupId }, include: { rows: { where: { status: 'VALID' }, orderBy: { rowNo: 'asc' } } } });
        if (!imp) throw Errors.notFound('รายการนำเข้า');
        if (imp.status !== 'VALIDATED') throw Errors.invalidState('รายการนำเข้านี้ดำเนินการไปแล้ว');
        if (!imp.rows.length) throw Errors.validation('ไม่มีแถวที่ถูกต้องให้นำเข้า');
        for (const row of imp.rows) {
          const member = (row.data as unknown as { _member: ParsedMember })._member;
          try {
            const reg = await this.groups.addMember(groupId, member, user.id, meta, { tx });
            await tx.groupImportRow.update({ where: { id: row.id }, data: { status: 'IMPORTED', registrationId: reg.id } });
          } catch (e) {
            const msg = e instanceof AppError ? (e.getResponse() as { message: string }).message : 'นำเข้าไม่สำเร็จ';
            throw Errors.validation(`แถวที่ ${row.rowNo}: ${msg}`, { row: row.rowNo });
          }
        }
        await tx.groupImport.update({ where: { id: importId }, data: { status: 'COMMITTED', committedAt: new Date() } });
        await this.groups.log(tx, groupId, 'import.commit', user.id, { after: { importId, members: imp.rows.length, fileName: imp.fileName } });
      },
      { timeout: 120_000 },
    );
    await this.audit.log({ actorId: user.id, action: 'group.import_commit', entityType: 'registration_group', entityId: groupId, after: { importId }, meta });
    return this.groups.buildDetail(groupId);
  }

  async discard(groupId: string, importId: string, user: AuthUser) {
    await this.groups.loadForCoordinator(groupId, user);
    const res = await this.prisma.groupImport.updateMany({ where: { id: importId, groupId, status: 'VALIDATED' }, data: { status: 'DISCARDED' } });
    if (!res.count) throw Errors.invalidState('รายการนำเข้านี้ดำเนินการไปแล้ว');
    return { discarded: true };
  }

  private async readRows(buf: Buffer): Promise<Cell[][]> {
    // .xlsx is a zip archive ("PK\x03\x04").
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
      throw new AppError('FILE_TYPE_NOT_ALLOWED', 'รองรับเฉพาะไฟล์ Excel (.xlsx) จากแม่แบบ', HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
    } catch {
      throw new AppError('FILE_TYPE_NOT_ALLOWED', 'อ่านไฟล์ Excel ไม่ได้ (รองรับ .xlsx)', HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const rows: Cell[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const values = (row.values as ExcelJS.CellValue[]).slice(1).map(cellValue);
      rows[n - 1] = values;
    });
    return Array.from(rows, (r) => r ?? []);
  }
}

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v !== 'object') return v as Cell;
  if ('richText' in v) return v.richText.map((t) => t.text).join('');
  if ('text' in v) return String(v.text);
  if ('result' in v) return cellValue(v.result as ExcelJS.CellValue);
  return null;
}
