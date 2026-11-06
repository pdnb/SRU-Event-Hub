import { Injectable, StreamableFile } from '@nestjs/common';
import { formatThaiDateTime, sanitizeSpreadsheetCell } from '@sru/shared-utils';
import ExcelJS from 'exceljs';
import type { AuthUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import type { RequestMeta } from '../common/decorators';
import { Errors } from '../common/errors';
import { Paginated } from '../common/pagination';
import { AttendanceStatus, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CheckinGateway } from './checkin.gateway';
import { AttendanceQueryDto, AttendanceSetDto } from './checkin.dto';
import { EventAccessService } from './event-access.service';

const LABEL: Record<AttendanceStatus, string> = { PRESENT: 'เข้าร่วม', LATE: 'มาสาย', ABSENT: 'ไม่เข้าร่วม', EXCUSED: 'ลา' };

/**
 * Attendance (spec §4.9): one row per confirmed registrant for the whole event and per session.
 * A registrant without a row has not arrived (shown as ABSENT). Staff with `attendance:update` can
 * set a status by hand (e.g. excused) — always with a note, audited; a later real scan wins.
 * Certificates (P5) will read the whole-event row.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: EventAccessService,
    private readonly gateway: CheckinGateway,
  ) {}

  async list(eventId: string, q: AttendanceQueryDto, user: AuthUser) {
    await this.access.assert(user, 'attendance:view', eventId);
    const scheduleId = q.scheduleId ?? null;
    if (scheduleId) await this.assertSchedule(eventId, scheduleId);
    const where = this.where(eventId, scheduleId, q);
    const [rows, total, summary] = await Promise.all([
      this.prisma.registration.findMany({
        where,
        include: {
          participantType: { select: { nameTh: true } },
          group: { select: { groupNo: true } },
          attendance: { where: { scheduleId }, select: { status: true, firstCheckinAt: true, lastCheckoutAt: true, isManual: true, note: true, updatedAt: true } },
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        skip: q.skip,
        take: q.perPage,
      }),
      this.prisma.registration.count({ where }),
      this.summary(eventId, scheduleId),
    ]);
    const items = rows.map((r) => {
      const a = r.attendance[0];
      return {
        registrationId: r.id,
        referenceNo: r.referenceNo,
        fullName: `${r.prefix ?? ''}${r.firstName} ${r.lastName}`.trim(),
        participantType: r.participantType.nameTh,
        affiliation: r.affiliation,
        groupNo: r.group?.groupNo ?? null,
        status: a?.status ?? 'ABSENT',
        firstCheckinAt: a?.firstCheckinAt ?? null,
        lastCheckoutAt: a?.lastCheckoutAt ?? null,
        isManual: a?.isManual ?? false,
        note: a?.note ?? null,
      };
    });
    const page = Paginated.of(items, total, q);
    return Object.assign(page, { meta: { ...page.meta, summary } });
  }

  async set(eventId: string, registrationId: string, dto: AttendanceSetDto, user: AuthUser, meta: RequestMeta) {
    await this.access.assert(user, 'attendance:update', eventId);
    const scheduleId = dto.scheduleId ?? null;
    if (scheduleId) await this.assertSchedule(eventId, scheduleId);
    const res = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${registrationId}::uuid FOR UPDATE`;
      const reg = await tx.registration.findUnique({ where: { id: registrationId }, select: { eventId: true, status: true } });
      if (!reg || reg.eventId !== eventId) throw Errors.notFound('การลงทะเบียนในกิจกรรมนี้');
      if (reg.status !== 'CONFIRMED') throw Errors.invalidState('บันทึกการเข้าร่วมได้เฉพาะผู้ลงทะเบียนที่ยืนยันแล้ว');
      const existing = await tx.attendanceRecord.findFirst({ where: { registrationId, scheduleId } });
      const data = { status: dto.status, isManual: true, note: dto.note.trim(), updatedById: user.id };
      const row = existing
        ? await tx.attendanceRecord.update({ where: { id: existing.id }, data })
        : await tx.attendanceRecord.create({ data: { eventId, registrationId, scheduleId, ...data } });
      await this.audit.log(
        { actorId: user.id, action: 'attendance.set', entityType: 'registration', entityId: registrationId, before: existing ? { status: existing.status, scheduleId } : { status: 'ABSENT', scheduleId }, after: { status: dto.status, scheduleId }, reason: dto.note, meta },
        tx,
      );
      return row;
    });
    this.gateway.notify({ eventId, kind: 'ATTENDANCE', count: 1 });
    return res;
  }

  async export(eventId: string, scheduleId: string | null, user: AuthUser, meta: RequestMeta) {
    const e = await this.access.assert(user, 'attendance:export', eventId);
    const schedules = await this.prisma.eventSchedule.findMany({ where: { eventId }, orderBy: { startAt: 'asc' }, select: { id: true, title: true } });
    if (scheduleId && !schedules.some((s) => s.id === scheduleId)) throw Errors.validation('ช่วงกิจกรรม (session) ไม่ถูกต้อง');
    const rows = await this.prisma.registration.findMany({
      where: { eventId, status: 'CONFIRMED' },
      include: {
        participantType: { select: { nameTh: true } },
        group: { select: { groupNo: true, participantOrganization: { select: { nameTh: true } } } },
        attendance: { select: { scheduleId: true, status: true, firstCheckinAt: true, lastCheckoutAt: true, isManual: true, note: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    const cols = scheduleId ? schedules.filter((s) => s.id === scheduleId) : schedules;
    const header = [
      'ลำดับ', 'เลขอ้างอิง', 'ชื่อ-นามสกุล', 'ประเภทผู้เข้าร่วม', 'หน่วยงาน/คณะ', 'รหัสนักศึกษา/บุคลากร', 'เลขที่กลุ่ม', 'องค์กรที่ส่งเข้าร่วม',
      'สถานะการเข้าร่วม (ทั้งกิจกรรม)', 'เวลาเช็กอิน', 'เวลาเช็กเอาต์', 'บันทึกโดยเจ้าหน้าที่', 'หมายเหตุ',
      ...cols.map((s) => `Session: ${s.title}`),
    ];
    const data = rows.map((r, i) => {
      const whole = r.attendance.find((a) => a.scheduleId === null);
      return [
        i + 1, r.referenceNo, `${r.prefix ?? ''}${r.firstName} ${r.lastName}`.trim(), r.participantType.nameTh, r.affiliation ?? '', r.studentOrStaffCode ?? '',
        r.group?.groupNo ?? '', r.group?.participantOrganization.nameTh ?? '',
        LABEL[whole?.status ?? 'ABSENT'], whole?.firstCheckinAt ? formatThaiDateTime(whole.firstCheckinAt) : '', whole?.lastCheckoutAt ? formatThaiDateTime(whole.lastCheckoutAt) : '',
        whole?.isManual ? 'ใช่' : '', whole?.note ?? '',
        ...cols.map((s) => LABEL[r.attendance.find((a) => a.scheduleId === s.id)?.status ?? 'ABSENT']),
      ].map(sanitizeSpreadsheetCell);
    });
    const wb = new ExcelJS.Workbook();
    wb.creator = 'SRU Event Hub';
    const ws = wb.addWorksheet('การเข้าร่วม');
    ws.addRow([`รายงานการเข้าร่วมกิจกรรม ${e.code} ${e.titleTh}`]).font = { bold: true, name: 'Sarabun', size: 14 };
    ws.addRow([`พิมพ์เมื่อ ${formatThaiDateTime(new Date())} · ผู้ลงทะเบียนที่ยืนยันแล้ว ${rows.length} คน`]);
    ws.addRow(header).font = { bold: true, name: 'Sarabun' };
    data.forEach((d) => ws.addRow(d));
    ws.columns.forEach((c, i) => (c.width = i === 2 ? 30 : 18));
    await this.audit.log({ actorId: user.id, action: 'attendance.export', entityType: 'event', entityId: eventId, after: { rows: rows.length, scheduleId }, meta });
    return new StreamableFile(Buffer.from(await wb.xlsx.writeBuffer()), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="attendance-${e.code}.xlsx"`,
    });
  }

  private where(eventId: string, scheduleId: string | null, q: AttendanceQueryDto): Prisma.RegistrationWhereInput {
    const status: Prisma.RegistrationWhereInput =
      q.status === 'ABSENT'
        ? { attendance: { none: { scheduleId, status: { in: ['PRESENT', 'LATE', 'EXCUSED'] } } } }
        : q.status
          ? { attendance: { some: { scheduleId, status: q.status } } }
          : {};
    return {
      eventId,
      status: 'CONFIRMED',
      ...(q.participantTypeId ? { participantTypeId: q.participantTypeId } : {}),
      ...status,
      ...(q.search
        ? {
            OR: [
              { firstName: { contains: q.search, mode: 'insensitive' } },
              { lastName: { contains: q.search, mode: 'insensitive' } },
              { referenceNo: q.search.toUpperCase() },
              { studentOrStaffCode: q.search },
            ],
          }
        : {}),
    };
  }

  private async summary(eventId: string, scheduleId: string | null) {
    const [confirmed, groups] = await Promise.all([
      this.prisma.registration.count({ where: { eventId, status: 'CONFIRMED' } }),
      this.prisma.attendanceRecord.groupBy({ by: ['status'], where: { eventId, scheduleId, registration: { status: 'CONFIRMED' } }, _count: { _all: true }, orderBy: { status: 'asc' } }),
    ]);
    const n = (s: AttendanceStatus) => (groups.find((g) => g.status === s)?._count as { _all: number } | undefined)?._all ?? 0;
    const recorded = n('PRESENT') + n('LATE') + n('EXCUSED');
    return { confirmed, present: n('PRESENT'), late: n('LATE'), excused: n('EXCUSED'), absent: Math.max(0, confirmed - recorded) };
  }

  private async assertSchedule(eventId: string, scheduleId: string) {
    const s = await this.prisma.eventSchedule.findUnique({ where: { id: scheduleId }, select: { eventId: true } });
    if (!s || s.eventId !== eventId) throw Errors.validation('ช่วงกิจกรรม (session) ไม่ถูกต้อง');
  }
}
