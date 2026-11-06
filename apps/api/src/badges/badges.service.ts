import { HttpStatus, Injectable, StreamableFile } from '@nestjs/common';
import { formatThaiDate, formatThaiDateTime } from '@sru/shared-utils';
import type { AuthUser } from '../auth/auth.types';
import { qrText } from '../checkin/checkin-token';
import { CheckinService } from '../checkin/checkin.service';
import { EventAccessService, ScopedEvent } from '../checkin/event-access.service';
import { AuditService } from '../common/audit.service';
import type { RequestMeta } from '../common/decorators';
import { AppError, Errors } from '../common/errors';
import { Paginated } from '../common/pagination';
import { BadgePrintMode, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { BadgeSubject, renderBadgesPdf, sheetLayout } from './badge-pdf';
import { BADGE_PLACEHOLDERS, BadgeTemplateSpec, defaultLayout, PERSONNEL_ROLE_LABEL, validateTemplate } from './badge-template';
import { BadgeTemplateDto, BadgeTemplateUpdateDto, CandidateQueryDto, PrintJobDto } from './badges.dto';

const MAX_JOB = 2000;
const BG_MAX_BYTES = 5_000_000;

const TEMPLATE_INCLUDE = {
  fields: { orderBy: { sortOrder: 'asc' } },
  colorRules: { orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.BadgeTemplateInclude;
type TemplateRow = Prisma.BadgeTemplateGetPayload<{ include: typeof TEMPLATE_INCLUDE }>;

const REG_BADGE_INCLUDE = {
  participantType: { select: { code: true, nameTh: true } },
  group: { select: { groupNo: true, name: true, participantOrganization: { select: { nameTh: true } } } },
} satisfies Prisma.RegistrationInclude;
type RegBadgeRow = Prisma.RegistrationGetPayload<{ include: typeof REG_BADGE_INCLUDE }>;

/**
 * Badges (spec §4.8.1): per-event templates (designer), batch printing, instant printing at the
 * check-in desk and controlled reprints. Every printed badge is an append-only `badge_prints` row:
 * print_no 1 is the first print; anything after needs `badge:reprint` and a reason. The unique
 * (subject, print_no) index stops two desks from printing the same "first" badge twice.
 */
@Injectable()
export class BadgesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly eventAccess: EventAccessService,
    private readonly checkin: CheckinService,
    private readonly storage: StorageService,
  ) {}

  placeholders() {
    return { placeholders: BADGE_PLACEHOLDERS, personnelRoles: PERSONNEL_ROLE_LABEL };
  }

  // ───────────── templates ─────────────

  async list(eventId: string, user: AuthUser) {
    await this.eventAccess.assert(user, 'badge:view', eventId);
    const rows = await this.prisma.badgeTemplate.findMany({
      where: { eventId, isActive: true },
      include: { _count: { select: { fields: true, jobs: true } } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(({ _count, ...t }) => ({ ...t, fieldCount: _count.fields, jobCount: _count.jobs, perSheet: t.paper === 'A4_SHEET' ? sheetLayout(t.widthMm, t.heightMm).perPage : 1 }));
  }

  async get(id: string, user: AuthUser) {
    const t = await this.loadTemplate(id);
    await this.eventAccess.assert(user, 'badge:view', t.eventId);
    return this.templateDto(t);
  }

  async create(eventId: string, dto: BadgeTemplateDto, user: AuthUser, meta: RequestMeta) {
    await this.eventAccess.assert(user, 'badge:create', eventId);
    const layout = dto.fields?.length ? { fields: this.fieldSpecs(dto), colorRules: this.ruleSpecs(dto) } : defaultLayout(dto.widthMm, dto.heightMm);
    this.assertValid({ widthMm: dto.widthMm, heightMm: dto.heightMm, fields: layout.fields });
    const t = await this.prisma.$transaction(async (tx) => {
      const isFirst = !(await tx.badgeTemplate.count({ where: { eventId, isActive: true } }));
      const makeDefault = dto.isDefault || isFirst;
      if (makeDefault) await tx.badgeTemplate.updateMany({ where: { eventId, isDefault: true }, data: { isDefault: false } });
      return tx.badgeTemplate.create({
        data: {
          eventId, nameTh: dto.nameTh.trim(), paper: dto.paper, widthMm: dto.widthMm, heightMm: dto.heightMm, backgroundColor: dto.backgroundColor ?? null,
          isDefault: makeDefault, createdById: user.id, updatedById: user.id,
          fields: { create: layout.fields },
          colorRules: { create: dto.colorRules ? this.ruleSpecs(dto) : layout.colorRules },
        },
        include: TEMPLATE_INCLUDE,
      });
    });
    await this.audit.log({ actorId: user.id, action: 'badge_template.create', entityType: 'badge_template', entityId: t.id, after: { eventId, nameTh: t.nameTh }, meta });
    return this.templateDto(t);
  }

  /** Replaces the whole layout. Optimistic lock on `version` so two designers do not overwrite each other. */
  async update(id: string, dto: BadgeTemplateUpdateDto, user: AuthUser, meta: RequestMeta) {
    const cur = await this.loadTemplate(id);
    await this.eventAccess.assert(user, 'badge:update', cur.eventId);
    const fields = this.fieldSpecs(dto);
    this.assertValid({ widthMm: dto.widthMm, heightMm: dto.heightMm, fields });
    const t = await this.prisma.$transaction(async (tx) => {
      const n = await tx.badgeTemplate.updateMany({
        where: { id, version: dto.version, isActive: true },
        data: {
          nameTh: dto.nameTh.trim(), paper: dto.paper, widthMm: dto.widthMm, heightMm: dto.heightMm, backgroundColor: dto.backgroundColor ?? null,
          ...(dto.removeBackground ? { backgroundFileId: null } : {}),
          version: { increment: 1 }, updatedById: user.id,
        },
      });
      if (!n.count) throw Errors.conflict('VERSION_CONFLICT', 'แม่แบบนี้ถูกแก้ไขโดยผู้อื่นแล้ว กรุณาโหลดใหม่');
      if (dto.isDefault && !cur.isDefault) {
        await tx.badgeTemplate.updateMany({ where: { eventId: cur.eventId, isDefault: true, id: { not: id } }, data: { isDefault: false } });
        await tx.badgeTemplate.update({ where: { id }, data: { isDefault: true } });
      }
      await tx.badgeTemplateField.deleteMany({ where: { templateId: id } });
      await tx.badgeColorRule.deleteMany({ where: { templateId: id } });
      await tx.badgeTemplateField.createMany({ data: fields.map((f) => ({ ...f, templateId: id })) });
      await tx.badgeColorRule.createMany({ data: this.ruleSpecs(dto).map((r) => ({ ...r, templateId: id })) });
      return tx.badgeTemplate.findUniqueOrThrow({ where: { id }, include: TEMPLATE_INCLUDE });
    });
    await this.audit.log({ actorId: user.id, action: 'badge_template.update', entityType: 'badge_template', entityId: id, before: { version: cur.version }, after: { version: t.version, fields: fields.length }, meta });
    return this.templateDto(t);
  }

  /** Deactivates (templates referenced by print jobs are kept for the history). */
  async remove(id: string, user: AuthUser, meta: RequestMeta) {
    const t = await this.loadTemplate(id);
    await this.eventAccess.assert(user, 'badge:update', t.eventId);
    await this.prisma.badgeTemplate.update({ where: { id }, data: { isActive: false, isDefault: false } });
    await this.audit.log({ actorId: user.id, action: 'badge_template.delete', entityType: 'badge_template', entityId: id, meta });
    return { deleted: true };
  }

  async setBackground(id: string, buf: Buffer, originalName: string, user: AuthUser, meta: RequestMeta) {
    const t = await this.loadTemplate(id);
    await this.eventAccess.assert(user, 'badge:update', t.eventId);
    const stored = await this.storage.putValidated(buf, { prefix: 'badge-backgrounds', allowed: ['png', 'jpg'], maxBytes: BG_MAX_BYTES });
    const file = await this.prisma.file.create({
      data: { ...stored, sizeBytes: BigInt(stored.sizeBytes), originalName: originalName.slice(0, 300), isPrivate: true, uploadedById: user.id },
    });
    const next = await this.prisma.badgeTemplate.update({ where: { id }, data: { backgroundFileId: file.id, version: { increment: 1 }, updatedById: user.id }, include: TEMPLATE_INCLUDE });
    await this.audit.log({ actorId: user.id, action: 'badge_template.background', entityType: 'badge_template', entityId: id, after: { fileId: file.id, sha256: stored.sha256 }, meta });
    return this.templateDto(next);
  }

  async background(id: string, user: AuthUser) {
    const t = await this.prisma.badgeTemplate.findUnique({ where: { id }, include: { background: true } });
    if (!t?.background) throw Errors.notFound('ภาพพื้นหลัง');
    await this.eventAccess.assert(user, 'badge:view', t.eventId);
    const bytes = await this.storage.getBytes(t.background.bucket, t.background.objectKey);
    return new StreamableFile(bytes, { type: t.background.mimeType, disposition: 'inline' });
  }

  /** Renders an unsaved draft with sample data (real registrants when there are any). */
  async preview(eventId: string, draft: BadgeTemplateDto, templateId: string | undefined, user: AuthUser) {
    const e = await this.eventAccess.assert(user, 'badge:view', eventId);
    const fields = this.fieldSpecs(draft);
    const spec: BadgeTemplateSpec = {
      nameTh: draft.nameTh, paper: draft.paper, widthMm: draft.widthMm, heightMm: draft.heightMm, backgroundColor: draft.backgroundColor ?? null,
      backgroundFileId: null, fields, colorRules: this.ruleSpecs(draft),
    };
    let background: Buffer | null = null;
    if (templateId) {
      const t = await this.prisma.badgeTemplate.findUnique({ where: { id: templateId }, include: { background: true } });
      if (t && t.eventId === eventId && t.background) background = await this.storage.getBytes(t.background.bucket, t.background.objectKey).catch(() => null);
    }
    const regs = await this.prisma.registration.findMany({ where: { eventId, status: 'CONFIRMED' }, include: REG_BADGE_INCLUDE, orderBy: { createdAt: 'asc' }, take: 3 });
    const people = await this.prisma.eventPersonnel.findMany({ where: { eventId, deletedAt: null }, orderBy: { createdAt: 'asc' }, take: 1 });
    const subjects: BadgeSubject[] = [
      ...regs.map((r) => this.regSubject(e, r, `${'SRU1.'}PREVIEW${'x'.repeat(17)}`)),
      ...people.map((p) => this.personnelSubject(e, p)),
    ];
    if (!subjects.length) subjects.push(this.sampleSubject(e));
    const pdf = await renderBadgesPdf(spec, subjects.slice(0, spec.paper === 'LABEL' ? 2 : sheetLayout(spec.widthMm, spec.heightMm).perPage), { title: `ตัวอย่างป้ายชื่อ ${e.code}`, background });
    return new StreamableFile(pdf, { type: 'application/pdf', disposition: 'inline; filename="badge-preview.pdf"' });
  }

  // ───────────── print candidates & jobs ─────────────

  async candidates(eventId: string, q: CandidateQueryDto, user: AuthUser) {
    await this.eventAccess.assert(user, 'badge:view', eventId);
    if (q.kind === 'personnel') {
      const where: Prisma.EventPersonnelWhereInput = {
        eventId, deletedAt: null,
        ...(q.printed === 'yes' ? { prints: { some: {} } } : q.printed === 'no' ? { prints: { none: {} } } : {}),
        ...(q.search ? { OR: [{ firstName: { contains: q.search, mode: 'insensitive' } }, { lastName: { contains: q.search, mode: 'insensitive' } }] } : {}),
      };
      const [rows, total] = await this.prisma.$transaction([
        this.prisma.eventPersonnel.findMany({ where, include: { prints: { orderBy: { printNo: 'desc' }, take: 1, select: { printNo: true, createdAt: true } } }, orderBy: [{ role: 'asc' }, { firstName: 'asc' }], skip: q.skip, take: q.perPage }),
        this.prisma.eventPersonnel.count({ where }),
      ]);
      return Paginated.of(
        rows.map((p) => ({ kind: 'personnel' as const, id: p.id, fullName: `${p.prefix ?? ''}${p.firstName} ${p.lastName}`.trim(), detail: PERSONNEL_ROLE_LABEL[p.role], affiliation: p.affiliation, printCount: p.prints[0]?.printNo ?? 0, lastPrintedAt: p.prints[0]?.createdAt ?? null, checkedIn: null })),
        total, q,
      );
    }
    const where: Prisma.RegistrationWhereInput = {
      eventId, status: 'CONFIRMED',
      ...(q.participantTypeId ? { participantTypeId: q.participantTypeId } : {}),
      ...(q.groupId ? { groupId: q.groupId } : {}),
      ...(q.printed === 'yes' ? { badgePrints: { some: {} } } : q.printed === 'no' ? { badgePrints: { none: {} } } : {}),
      ...(q.search
        ? { OR: [{ firstName: { contains: q.search, mode: 'insensitive' } }, { lastName: { contains: q.search, mode: 'insensitive' } }, { referenceNo: q.search.toUpperCase() }, { group: { groupNo: q.search.toUpperCase() } }] }
        : {}),
    };
    const [rows, total, printed] = await this.prisma.$transaction([
      this.prisma.registration.findMany({
        where,
        include: {
          participantType: { select: { nameTh: true } },
          group: { select: { groupNo: true } },
          badgePrints: { orderBy: { printNo: 'desc' }, take: 1, select: { printNo: true, createdAt: true } },
          attendance: { where: { scheduleId: null }, select: { status: true } },
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        skip: q.skip,
        take: q.perPage,
      }),
      this.prisma.registration.count({ where }),
      this.prisma.registration.count({ where: { eventId, status: 'CONFIRMED', badgePrints: { some: {} } } }),
    ]);
    const page = Paginated.of(
      rows.map((r) => ({
        kind: 'registration' as const,
        id: r.id,
        referenceNo: r.referenceNo,
        fullName: `${r.prefix ?? ''}${r.firstName} ${r.lastName}`.trim(),
        detail: r.participantType.nameTh,
        affiliation: r.affiliation,
        groupNo: r.group?.groupNo ?? null,
        printCount: r.badgePrints[0]?.printNo ?? 0,
        lastPrintedAt: r.badgePrints[0]?.createdAt ?? null,
        checkedIn: ['PRESENT', 'LATE'].includes(r.attendance[0]?.status ?? ''),
      })),
      total, q,
    );
    return Object.assign(page, { meta: { ...page.meta, printedTotal: printed } });
  }

  async createJob(eventId: string, dto: PrintJobDto, user: AuthUser, meta: RequestMeta) {
    const e = await this.eventAccess.assert(user, 'badge:print', eventId);
    const template = await this.loadTemplate(dto.templateId);
    if (template.eventId !== eventId || !template.isActive) throw Errors.validation('แม่แบบป้ายชื่อไม่ถูกต้อง');
    this.assertValid(this.templateDto(template));

    const wantsReprint = dto.mode === 'REPRINT' || !!dto.filter?.includePrinted;
    if (wantsReprint) {
      if (!(await this.eventAccess.can(user, 'badge:reprint', e))) throw Errors.forbidden('ไม่มีสิทธิ์พิมพ์ป้ายชื่อซ้ำ');
      if (!dto.reason?.trim()) throw Errors.validation('กรุณาระบุเหตุผลการพิมพ์ซ้ำ');
    }

    // ── resolve subjects ──
    let regIds: string[];
    let personnelIds: string[] = [...new Set(dto.personnelIds ?? [])];
    if (dto.registrationIds?.length || dto.personnelIds?.length || dto.mode !== 'BATCH') {
      regIds = [...new Set(dto.registrationIds ?? [])];
    } else {
      const f = dto.filter ?? {};
      regIds = (
        await this.prisma.registration.findMany({
          where: {
            eventId, status: 'CONFIRMED',
            ...(f.participantTypeIds?.length ? { participantTypeId: { in: f.participantTypeIds } } : {}),
            ...(f.groupId ? { groupId: f.groupId } : {}),
            ...(f.includePrinted ? {} : { badgePrints: { none: {} } }),
          },
          select: { id: true },
          orderBy: [{ groupId: 'asc' }, { firstName: 'asc' }, { lastName: 'asc' }],
          take: MAX_JOB + 1,
        })
      ).map((r) => r.id);
      if (f.includePersonnel) {
        personnelIds = (await this.prisma.eventPersonnel.findMany({ where: { eventId, deletedAt: null, ...(f.includePrinted ? {} : { prints: { none: {} } }) }, select: { id: true }, orderBy: [{ role: 'asc' }, { firstName: 'asc' }] })).map((p) => p.id);
      }
    }
    if (dto.mode === 'INSTANT' && regIds.length + personnelIds.length !== 1) throw Errors.validation('การพิมพ์ทันทีต้องเลือก 1 รายการ');
    if (regIds.length + personnelIds.length > MAX_JOB) throw Errors.validation(`พิมพ์ได้ครั้งละไม่เกิน ${MAX_JOB} ป้าย กรุณาแบ่งเป็นหลายชุด`);
    if (!regIds.length && !personnelIds.length) throw Errors.validation('ไม่มีรายชื่อที่ต้องพิมพ์ (อาจพิมพ์ครบแล้ว)');

    const regs = regIds.length ? await this.prisma.registration.findMany({ where: { id: { in: regIds } }, select: { id: true, eventId: true, status: true, _count: { select: { badgePrints: true } } } }) : [];
    if (regs.length !== regIds.length || regs.some((r) => r.eventId !== eventId)) throw Errors.validation('มีรายชื่อที่ไม่อยู่ในกิจกรรมนี้');
    if (regs.some((r) => r.status !== 'CONFIRMED')) throw Errors.invalidState('พิมพ์ป้ายชื่อได้เฉพาะผู้ลงทะเบียนที่ยืนยันแล้ว');
    const people = personnelIds.length ? await this.prisma.eventPersonnel.findMany({ where: { id: { in: personnelIds }, eventId, deletedAt: null }, select: { id: true, _count: { select: { prints: true } } } }) : [];
    if (people.length !== personnelIds.length) throw Errors.validation('มีบุคลากรที่ไม่อยู่ในกิจกรรมนี้');

    const alreadyPrinted = regs.filter((r) => r._count.badgePrints > 0).length + people.filter((p) => p._count.prints > 0).length;
    if (alreadyPrinted && !wantsReprint) {
      throw new AppError('ALREADY_PRINTED', alreadyPrinted === 1 && regs.length + people.length === 1 ? 'ป้ายชื่อนี้พิมพ์ไปแล้ว หากต้องการพิมพ์ซ้ำต้องระบุเหตุผล' : `มี ${alreadyPrinted} รายการที่พิมพ์ป้ายแล้ว (การพิมพ์อีกครั้งถือเป็นการพิมพ์ซ้ำ)`, HttpStatus.CONFLICT, { alreadyPrinted });
    }
    const mode: BadgePrintMode = dto.mode === 'BATCH' && alreadyPrinted ? 'REPRINT' : dto.mode;
    const order = new Map(regIds.map((id, i) => [id, i]));
    const pOrder = new Map(personnelIds.map((id, i) => [id, regIds.length + i]));

    try {
      const job = await this.prisma.$transaction(async (tx) => {
        const job = await tx.badgePrintJob.create({
          data: {
            eventId, templateId: template.id, templateSnapshot: this.snapshot(template) as unknown as Prisma.InputJsonValue, mode, itemCount: regIds.length + personnelIds.length,
            reason: dto.reason?.trim() || null, requestedById: user.id,
          },
        });
        // print_no is assigned from the current maximum; the unique index rejects a concurrent duplicate.
        const maxReg = regIds.length
          ? await tx.badgePrint.groupBy({ by: ['registrationId'], where: { registrationId: { in: regIds } }, _max: { printNo: true }, orderBy: { registrationId: 'asc' } })
          : [];
        const maxPer = personnelIds.length
          ? await tx.badgePrint.groupBy({ by: ['personnelId'], where: { personnelId: { in: personnelIds } }, _max: { printNo: true }, orderBy: { personnelId: 'asc' } })
          : [];
        const regMax = new Map(maxReg.map((m) => [m.registrationId, (m._max as { printNo: number | null }).printNo ?? 0]));
        const perMax = new Map(maxPer.map((m) => [m.personnelId, (m._max as { printNo: number | null }).printNo ?? 0]));
        await tx.badgePrint.createMany({
          data: [
            ...regIds.map((id) => ({ jobId: job.id, eventId, registrationId: id, printNo: (regMax.get(id) ?? 0) + 1, sortOrder: order.get(id)! })),
            ...personnelIds.map((id) => ({ jobId: job.id, eventId, personnelId: id, printNo: (perMax.get(id) ?? 0) + 1, sortOrder: pOrder.get(id)! })),
          ],
        });
        await this.audit.log({ actorId: user.id, action: `badge.${mode.toLowerCase()}`, entityType: 'badge_print_job', entityId: job.id, after: { eventId, items: job.itemCount, templateId: template.id }, reason: dto.reason ?? null, meta }, tx);
        return job;
      });
      return { id: job.id, mode: job.mode, itemCount: job.itemCount, reprinted: alreadyPrinted, createdAt: job.createdAt };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError('ALREADY_PRINTED', 'มีการพิมพ์ป้ายชื่อรายการนี้จากอีกจุดหนึ่งพร้อมกัน กรุณาตรวจสอบก่อนพิมพ์ซ้ำ', HttpStatus.CONFLICT);
      }
      throw err;
    }
  }

  async jobs(eventId: string, q: CandidateQueryDto, user: AuthUser) {
    await this.eventAccess.assert(user, 'badge:view', eventId);
    const where = { eventId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.badgePrintJob.findMany({
        where,
        select: { id: true, mode: true, itemCount: true, reason: true, downloadCount: true, lastDownloadedAt: true, createdAt: true, template: { select: { nameTh: true } }, requestedBy: { select: { displayName: true } } },
        orderBy: { createdAt: 'desc' },
        skip: q.skip,
        take: q.perPage,
      }),
      this.prisma.badgePrintJob.count({ where }),
    ]);
    return Paginated.of(rows, total, q);
  }

  /** History of one registrant's / personnel's badge (shown before a reprint). */
  async history(subject: { registrationId?: string; personnelId?: string }, user: AuthUser) {
    const eventId = subject.registrationId
      ? (await this.prisma.registration.findUnique({ where: { id: subject.registrationId }, select: { eventId: true } }))?.eventId
      : (await this.prisma.eventPersonnel.findUnique({ where: { id: subject.personnelId! }, select: { eventId: true } }))?.eventId;
    if (!eventId) throw Errors.notFound('รายการ');
    await this.eventAccess.assert(user, 'badge:view', eventId);
    return this.prisma.badgePrint.findMany({
      where: subject.registrationId ? { registrationId: subject.registrationId } : { personnelId: subject.personnelId },
      select: { printNo: true, createdAt: true, job: { select: { id: true, mode: true, reason: true, requestedBy: { select: { displayName: true } } } } },
      orderBy: { printNo: 'asc' },
    });
  }

  /** Renders a job's PDF from its template snapshot. Each download is counted and audited. */
  async pdf(jobId: string, user: AuthUser, meta: RequestMeta) {
    const job = await this.prisma.badgePrintJob.findUnique({ where: { id: jobId } });
    if (!job) throw Errors.notFound('งานพิมพ์ป้ายชื่อ');
    const e = await this.eventAccess.assert(user, 'badge:print', job.eventId);
    const spec = job.templateSnapshot as unknown as BadgeTemplateSpec;
    const prints = await this.prisma.badgePrint.findMany({
      where: { jobId },
      include: { registration: { include: REG_BADGE_INCLUDE }, personnel: true },
      orderBy: { sortOrder: 'asc' },
    });
    const regIds = prints.flatMap((p) => (p.registrationId ? [p.registrationId] : []));
    const tokens = await this.checkin.ensureTokens(job.eventId, regIds);
    const subjects = prints.map((p) =>
      p.registration
        ? { ...this.regSubject(e, p.registration, qrText(tokens.get(p.registration.id)!)), printNo: p.printNo }
        : { ...this.personnelSubject(e, p.personnel!), printNo: p.printNo },
    );
    let background: Buffer | null = null;
    if (spec.backgroundFileId) {
      const f = await this.prisma.file.findUnique({ where: { id: spec.backgroundFileId } });
      if (f) background = await this.storage.getBytes(f.bucket, f.objectKey).catch(() => null);
    }
    const buf = await renderBadgesPdf(spec, subjects, { title: `ป้ายชื่อ ${e.code} (${formatThaiDateTime(job.createdAt)})`, background });
    await this.prisma.badgePrintJob.update({ where: { id: jobId }, data: { downloadCount: { increment: 1 }, lastDownloadedAt: new Date() } });
    if (job.downloadCount > 0) {
      await this.audit.log({ actorId: user.id, action: 'badge.redownload', entityType: 'badge_print_job', entityId: jobId, after: { downloadCount: job.downloadCount + 1 }, meta });
    }
    return new StreamableFile(buf, { type: 'application/pdf', disposition: `inline; filename="badges-${e.code}-${jobId.slice(-8)}.pdf"` });
  }

  // ───────────── helpers ─────────────

  private regSubject(e: ScopedEvent, r: RegBadgeRow, qr: string): BadgeSubject {
    return {
      qr,
      participantTypeCode: r.participantType.code,
      vars: {
        ...this.eventVars(e),
        fullName: `${r.prefix ?? ''}${r.firstName} ${r.lastName}`.trim(),
        prefix: r.prefix, firstName: r.firstName, lastName: r.lastName,
        affiliation: r.affiliation ?? r.group?.participantOrganization.nameTh ?? '',
        program: r.program, position: '',
        participantType: r.participantType.nameTh,
        referenceNo: r.referenceNo, code: r.studentOrStaffCode,
        groupNo: r.group?.groupNo, groupName: r.group?.name, organizationName: r.group?.participantOrganization.nameTh,
      },
    };
  }

  private personnelSubject(e: ScopedEvent, p: { prefix: string | null; firstName: string; lastName: string; position: string | null; affiliation: string | null; role: string }): BadgeSubject {
    return {
      qr: null,
      personnelRole: p.role,
      vars: {
        ...this.eventVars(e),
        fullName: `${p.prefix ?? ''}${p.firstName} ${p.lastName}`.trim(),
        prefix: p.prefix, firstName: p.firstName, lastName: p.lastName,
        affiliation: p.affiliation, position: p.position,
        participantType: PERSONNEL_ROLE_LABEL[p.role] ?? p.role,
      },
    };
  }

  private sampleSubject(e: ScopedEvent): BadgeSubject {
    return {
      qr: `SRU1.PREVIEW${'x'.repeat(17)}`,
      participantTypeCode: 'EXTERNAL',
      vars: {
        ...this.eventVars(e),
        fullName: 'นางสาวตัวอย่าง ชื่อยาวพอสมควรเพื่อทดสอบการตัดคำ', prefix: 'นางสาว', firstName: 'ตัวอย่าง', lastName: 'ชื่อยาวพอสมควรเพื่อทดสอบการตัดคำ',
        affiliation: 'คณะวิทยาศาสตร์และเทคโนโลยี มหาวิทยาลัยราชภัฏสุราษฎร์ธานี', participantType: 'บุคคลภายนอก', referenceNo: 'REG-2570-000001',
        groupNo: 'GRP-2570-000001', groupName: 'คณะครูโรงเรียนตัวอย่าง', organizationName: 'โรงเรียนตัวอย่าง', code: '6612345001',
      },
    };
  }

  private eventVars(e: ScopedEvent) {
    return { eventTitle: e.titleTh, eventCode: e.code, eventDate: formatThaiDate(e.startAt), venue: e.venueText ?? '' };
  }

  private fieldSpecs(dto: BadgeTemplateDto) {
    return (dto.fields ?? []).map((f, i) => ({
      kind: f.kind, content: f.kind === 'QR' ? null : (f.content ?? '').trim(), xMm: f.xMm, yMm: f.yMm, wMm: f.wMm, hMm: f.hMm,
      fontSize: f.fontSize ?? 12, bold: f.bold ?? false, align: f.align ?? 'center', color: f.color ?? null, sortOrder: i,
    }));
  }

  private ruleSpecs(dto: BadgeTemplateDto) {
    return (dto.colorRules ?? []).map((r, i) => ({ matchType: r.matchType, matchValue: r.matchType === 'ANY' ? null : (r.matchValue ?? null), color: r.color, label: r.label?.trim() || null, sortOrder: i }));
  }

  private assertValid(t: Pick<BadgeTemplateSpec, 'widthMm' | 'heightMm' | 'fields'>) {
    const errors = validateTemplate(t);
    if (errors.length) throw Errors.validation('แม่แบบป้ายชื่อไม่ถูกต้อง', errors);
  }

  private snapshot(t: TemplateRow): BadgeTemplateSpec {
    const d = this.templateDto(t);
    return { nameTh: d.nameTh, paper: d.paper, widthMm: d.widthMm, heightMm: d.heightMm, backgroundColor: d.backgroundColor, backgroundFileId: d.backgroundFileId, fields: d.fields, colorRules: d.colorRules };
  }

  private async loadTemplate(id: string) {
    const t = await this.prisma.badgeTemplate.findUnique({ where: { id }, include: TEMPLATE_INCLUDE });
    if (!t) throw Errors.notFound('แม่แบบป้ายชื่อ');
    return t;
  }

  private templateDto(t: TemplateRow) {
    return {
      id: t.id, eventId: t.eventId, nameTh: t.nameTh, paper: t.paper, widthMm: t.widthMm, heightMm: t.heightMm,
      backgroundColor: t.backgroundColor, backgroundFileId: t.backgroundFileId, isDefault: t.isDefault, isActive: t.isActive, version: t.version, updatedAt: t.updatedAt,
      perSheet: t.paper === 'A4_SHEET' ? sheetLayout(t.widthMm, t.heightMm).perPage : 1,
      fields: t.fields.map((f) => ({ kind: f.kind as 'TEXT' | 'QR' | 'BAND', content: f.content, xMm: f.xMm, yMm: f.yMm, wMm: f.wMm, hMm: f.hMm, fontSize: f.fontSize, bold: f.bold, align: f.align as 'left' | 'center' | 'right', color: f.color, sortOrder: f.sortOrder })),
      colorRules: t.colorRules.map((r) => ({ matchType: r.matchType as 'PARTICIPANT_TYPE' | 'PERSONNEL_ROLE' | 'ANY', matchValue: r.matchValue, color: r.color, label: r.label, sortOrder: r.sortOrder })),
    };
  }
}
