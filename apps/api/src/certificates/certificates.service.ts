import { HttpStatus, Injectable, StreamableFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { formatThaiDate, formatThaiDateTime, sanitizeSpreadsheetCell } from '@sru/shared-utils';
import ExcelJS from 'exceljs';
import type { AuthUser } from '../auth/auth.types';
import { PERSONNEL_ROLE_LABEL } from '../badges/badge-template';
import { EventAccessService, ScopedEvent } from '../checkin/event-access.service';
import { AuditService } from '../common/audit.service';
import type { RequestMeta } from '../common/decorators';
import { deriveKey, hmacHex } from '../common/derived-key';
import { AppError, Errors } from '../common/errors';
import { guestRegistrationId } from '../common/guest-access';
import { Paginated } from '../common/pagination';
import { SequenceService } from '../common/sequence.service';
import type { Env } from '../config/env';
import { CertificateIssueMethod, PersonnelRole, Prisma } from '../generated/prisma/client';
import { EvaluationsService } from '../evaluations/evaluations.service';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CertSubject, renderCertificatesPdf } from './certificate-pdf';
import {
  CERT_PLACEHOLDERS,
  CertFieldSpec,
  CertTemplateSpec,
  checkEligibility,
  defaultCertLayout,
  Eligibility,
  formatVerifyCode,
  newVerifyCode,
  normalizeVerifyCode,
  validateCertTemplate,
} from './certificate-template';
import { BatchPdfDto, CertCandidateQueryDto, CertListQueryDto, CertTemplateDto, CertTemplateUpdateDto, IssueDto } from './certificates.dto';

const MAX_ISSUE = 2000;
const MAX_PDF = 500;
const BG_MAX_BYTES = 8_000_000;

type TemplateRow = Prisma.CertificateTemplateGetPayload<object>;

export interface EventInfo extends ScopedEvent {
  organizationName: string;
  hours: string;
}

export interface Candidate {
  kind: 'registration' | 'personnel';
  id: string;
  referenceNo: string | null;
  fullName: string;
  detail: string;
  affiliation: string | null;
  attendance: string | null;
  sessions: string | null;
  eligibility: Eligibility;
  certificate: { id: string; certificateNo: string; issuedAt: Date } | null;
}

/**
 * Certificates (spec §4.10). Per-event templates (designer, background image, eligibility rules),
 * batch / single issue by staff, self-claim by eligible participants, revoke, and public verification
 * by a printed code / QR.
 *
 * Issuing locks the template row (`FOR UPDATE`), re-checks inside the transaction and takes the
 * number from the gap-free CERT sequence, so two desks / a double click never issue twice and
 * numbers never skip. A certificate snapshots the template and the placeholder values; the database
 * forbids changing them afterwards (trigger) — reprinting always produces the same document.
 */
@Injectable()
export class CertificatesService {
  private readonly ipKey: Buffer;
  private readonly webUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly eventAccess: EventAccessService,
    private readonly seq: SequenceService,
    private readonly storage: StorageService,
    private readonly evaluations: EvaluationsService,
    config: ConfigService<Env, true>,
  ) {
    this.ipKey = deriveKey(String(config.get('FIELD_ENCRYPTION_KEY', { infer: true })), 'certificate-verify-ip/v1');
    this.webUrl = String(config.get('WEB_PUBLIC_URL', { infer: true })).replace(/\/$/, '');
  }

  placeholders() {
    return { placeholders: CERT_PLACEHOLDERS, personnelRoles: PERSONNEL_ROLE_LABEL };
  }

  verifyUrl(code: string) {
    return `${this.webUrl}/verify/${formatVerifyCode(code)}`;
  }

  // ───────────── templates ─────────────

  async listTemplates(eventId: string, user: AuthUser) {
    await this.eventAccess.assert(user, 'certificate:view', eventId);
    const rows = await this.prisma.certificateTemplate.findMany({ where: { eventId, isActive: true }, orderBy: { createdAt: 'asc' } });
    const counts = await this.prisma.certificate.groupBy({ by: ['templateId'], where: { eventId, status: 'ISSUED' }, _count: { _all: true }, orderBy: { templateId: 'asc' } });
    const n = new Map(counts.map((c) => [c.templateId, (c._count as { _all: number })._all]));
    return rows.map((t) => ({ ...this.templateDto(t), issuedCount: n.get(t.id) ?? 0 }));
  }

  async getTemplate(id: string, user: AuthUser) {
    const t = await this.loadTemplate(id);
    await this.eventAccess.assert(user, 'certificate:view', t.eventId);
    return this.templateDto(t);
  }

  async createTemplate(eventId: string, dto: CertTemplateDto, user: AuthUser, meta: RequestMeta) {
    await this.eventAccess.assert(user, 'certificate:create', eventId);
    const fields = dto.fields?.length ? this.fieldSpecs(dto) : defaultCertLayout(dto.widthMm, dto.heightMm);
    this.assertValid({ widthMm: dto.widthMm, heightMm: dto.heightMm, fields });
    const t = await this.prisma.certificateTemplate.create({
      data: { eventId, ...this.templateData(dto), fields: fields as unknown as Prisma.InputJsonValue, createdById: user.id, updatedById: user.id },
    });
    await this.audit.log({ actorId: user.id, action: 'certificate_template.create', entityType: 'certificate_template', entityId: t.id, after: { eventId, nameTh: t.nameTh, audience: t.audience }, meta });
    return this.templateDto(t);
  }

  async updateTemplate(id: string, dto: CertTemplateUpdateDto, user: AuthUser, meta: RequestMeta) {
    const cur = await this.loadTemplate(id);
    await this.eventAccess.assert(user, 'certificate:update', cur.eventId);
    const fields = this.fieldSpecs(dto);
    this.assertValid({ widthMm: dto.widthMm, heightMm: dto.heightMm, fields });
    if (dto.audience !== cur.audience && (await this.prisma.certificate.count({ where: { templateId: id } }))) {
      throw Errors.invalidState('ออกเกียรติบัตรจากแม่แบบนี้แล้ว จึงเปลี่ยนกลุ่มผู้รับไม่ได้');
    }
    const n = await this.prisma.certificateTemplate.updateMany({
      where: { id, version: dto.version, isActive: true },
      data: {
        ...this.templateData(dto),
        fields: fields as unknown as Prisma.InputJsonValue,
        ...(dto.removeBackground ? { backgroundFileId: null } : {}),
        version: { increment: 1 },
        updatedById: user.id,
      },
    });
    if (!n.count) throw Errors.conflict('VERSION_CONFLICT', 'แม่แบบนี้ถูกแก้ไขโดยผู้อื่นแล้ว กรุณาโหลดใหม่');
    const t = await this.loadTemplate(id);
    await this.audit.log({ actorId: user.id, action: 'certificate_template.update', entityType: 'certificate_template', entityId: id, before: { version: cur.version }, after: { version: t.version, fields: fields.length }, meta });
    return this.templateDto(t);
  }

  async removeTemplate(id: string, user: AuthUser, meta: RequestMeta) {
    const t = await this.loadTemplate(id);
    await this.eventAccess.assert(user, 'certificate:update', t.eventId);
    await this.prisma.certificateTemplate.update({ where: { id }, data: { isActive: false } });
    await this.audit.log({ actorId: user.id, action: 'certificate_template.delete', entityType: 'certificate_template', entityId: id, meta });
    return { deleted: true };
  }

  async setBackground(id: string, buf: Buffer, originalName: string, user: AuthUser, meta: RequestMeta) {
    const t = await this.loadTemplate(id);
    await this.eventAccess.assert(user, 'certificate:update', t.eventId);
    const stored = await this.storage.putValidated(buf, { prefix: 'certificate-backgrounds', allowed: ['png', 'jpg'], maxBytes: BG_MAX_BYTES });
    const file = await this.prisma.file.create({
      data: { ...stored, sizeBytes: BigInt(stored.sizeBytes), originalName: originalName.slice(0, 300), isPrivate: true, uploadedById: user.id },
    });
    const next = await this.prisma.certificateTemplate.update({ where: { id }, data: { backgroundFileId: file.id, version: { increment: 1 }, updatedById: user.id } });
    await this.audit.log({ actorId: user.id, action: 'certificate_template.background', entityType: 'certificate_template', entityId: id, after: { fileId: file.id, sha256: stored.sha256 }, meta });
    return this.templateDto(next);
  }

  async background(id: string, user: AuthUser) {
    const t = await this.prisma.certificateTemplate.findUnique({ where: { id }, include: { background: true } });
    if (!t?.background) throw Errors.notFound('ภาพพื้นหลัง');
    await this.eventAccess.assert(user, 'certificate:view', t.eventId);
    const bytes = await this.storage.getBytes(t.background.bucket, t.background.objectKey);
    return new StreamableFile(bytes, { type: t.background.mimeType, disposition: 'inline' });
  }

  /** Renders an unsaved draft for one sample recipient (a real registrant when there is one). */
  async preview(eventId: string, draft: CertTemplateDto, templateId: string | undefined, user: AuthUser) {
    const e = await this.eventInfo(await this.eventAccess.assert(user, 'certificate:view', eventId));
    const spec: CertTemplateSpec = { nameTh: draft.nameTh, widthMm: draft.widthMm, heightMm: draft.heightMm, backgroundColor: draft.backgroundColor ?? null, backgroundFileId: null, fields: this.fieldSpecs(draft) };
    const background = templateId ? await this.backgroundBytes(templateId, eventId) : null;
    const reg = await this.prisma.registration.findFirst({ where: { eventId, status: 'CONFIRMED' }, include: { participantType: { select: { nameTh: true } } }, orderBy: { createdAt: 'asc' } });
    const code = 'PREVIEW00000';
    const vars = {
      ...this.eventVars(e),
      ...(reg
        ? this.regVars(reg)
        : { fullName: 'นางสาวตัวอย่าง ชื่อยาวพอสมควรเพื่อทดสอบการจัดวาง', prefix: 'นางสาว', firstName: 'ตัวอย่าง', lastName: 'ชื่อยาวพอสมควรเพื่อทดสอบการจัดวาง', affiliation: 'คณะวิทยาศาสตร์และเทคโนโลยี', role: 'ผู้เข้าร่วม', participantType: 'บุคคลภายนอก' }),
      certificateNo: 'CERT-0000-000000',
      verifyCode: formatVerifyCode(code),
      verifyUrl: this.verifyUrl(code),
      issueDate: formatThaiDate(new Date()),
    };
    const pdf = await renderCertificatesPdf([{ spec, background, vars, qr: this.verifyUrl(code), watermark: 'ตัวอย่าง' }], { title: `ตัวอย่างเกียรติบัตร ${e.code}` });
    return new StreamableFile(pdf, { type: 'application/pdf', disposition: 'inline; filename="certificate-preview.pdf"' });
  }

  // ───────────── candidates & eligibility ─────────────

  async candidates(eventId: string, q: CertCandidateQueryDto, user: AuthUser) {
    await this.eventAccess.assert(user, 'certificate:view', eventId);
    const t = await this.loadTemplate(q.templateId);
    if (t.eventId !== eventId) throw Errors.validation('แม่แบบเกียรติบัตรไม่ถูกต้อง');
    let all = await this.allCandidates(t);
    if (q.search) {
      const s = q.search.toLowerCase();
      all = all.filter((c) => c.fullName.toLowerCase().includes(s) || c.referenceNo?.toLowerCase() === s || c.certificate?.certificateNo.toLowerCase() === s);
    }
    const summary = {
      total: all.length,
      eligible: all.filter((c) => c.eligibility.eligible).length,
      issued: all.filter((c) => c.certificate).length,
      pending: all.filter((c) => c.eligibility.eligible && !c.certificate).length,
    };
    if (q.filter === 'eligible') all = all.filter((c) => c.eligibility.eligible);
    if (q.filter === 'ineligible') all = all.filter((c) => !c.eligibility.eligible);
    if (q.filter === 'issued') all = all.filter((c) => c.certificate);
    if (q.filter === 'not_issued') all = all.filter((c) => !c.certificate);
    const page = Paginated.of(all.slice(q.skip, q.skip + q.perPage), all.length, q);
    return Object.assign(page, { meta: { ...page.meta, summary } });
  }

  /** Every potential recipient of a template with eligibility and existing certificate (bulk queries). */
  private async allCandidates(t: TemplateRow): Promise<Candidate[]> {
    const issued = await this.prisma.certificate.findMany({
      where: { templateId: t.id, status: 'ISSUED' },
      select: { id: true, certificateNo: true, issuedAt: true, registrationId: true, personnelId: true },
    });
    const bySubject = new Map(issued.map((c) => [c.registrationId ?? c.personnelId!, { id: c.id, certificateNo: c.certificateNo, issuedAt: c.issuedAt }]));

    if (t.audience === 'PERSONNEL') {
      const people = await this.prisma.eventPersonnel.findMany({
        where: { eventId: t.eventId, deletedAt: null, ...(t.personnelRoles.length ? { role: { in: t.personnelRoles } } : {}) },
        orderBy: [{ role: 'asc' }, { firstName: 'asc' }],
      });
      return people.map((p) => ({
        kind: 'personnel',
        id: p.id,
        referenceNo: null,
        fullName: `${p.prefix ?? ''}${p.firstName} ${p.lastName}`.trim(),
        detail: PERSONNEL_ROLE_LABEL[p.role] ?? p.role,
        affiliation: p.affiliation,
        attendance: null,
        sessions: null,
        eligibility: { eligible: true, reasons: [] },
        certificate: bySubject.get(p.id) ?? null,
      }));
    }

    const regs = await this.prisma.registration.findMany({
      where: { eventId: t.eventId, status: 'CONFIRMED' },
      select: { id: true, referenceNo: true, status: true, prefix: true, firstName: true, lastName: true, affiliation: true, participantType: { select: { nameTh: true } } },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    const facts = await this.facts(t.eventId, regs.map((r) => r.id), t.countLate);
    return regs.map((r) => {
      const f = facts.get(r.id)!;
      return {
        kind: 'registration',
        id: r.id,
        referenceNo: r.referenceNo,
        fullName: `${r.prefix ?? ''}${r.firstName} ${r.lastName}`.trim(),
        detail: r.participantType.nameTh,
        affiliation: r.affiliation,
        attendance: f.attendance,
        sessions: f.sessionsTotal ? `${f.sessionsAttended}/${f.sessionsTotal}` : null,
        eligibility: checkEligibility(this.rules(t), { ...f, registrationStatus: r.status }),
        certificate: bySubject.get(r.id) ?? null,
      };
    });
  }

  /** Attendance, sessions and evaluation facts for many registrations of one event. */
  private async facts(eventId: string, regIds: string[], countLate: boolean) {
    const attended = countLate ? (['PRESENT', 'LATE'] as const) : (['PRESENT'] as const);
    const [whole, sessionsTotal, perSession, evals] = await Promise.all([
      regIds.length ? this.prisma.attendanceRecord.findMany({ where: { eventId, scheduleId: null, registrationId: { in: regIds } }, select: { registrationId: true, status: true } }) : [],
      this.prisma.eventSchedule.count({ where: { eventId } }),
      regIds.length
        ? this.prisma.attendanceRecord.groupBy({
            by: ['registrationId'],
            where: { eventId, scheduleId: { not: null }, status: { in: [...attended] }, registrationId: { in: regIds } },
            _count: { _all: true },
            orderBy: { registrationId: 'asc' },
          })
        : [],
      this.evaluations.completion(eventId, regIds),
    ]);
    const att = new Map(whole.map((a) => [a.registrationId, a.status as string]));
    const ses = new Map(perSession.map((s) => [s.registrationId, (s._count as { _all: number })._all]));
    return new Map(
      regIds.map((id) => [
        id,
        {
          attendance: att.get(id) ?? null,
          sessionsTotal,
          sessionsAttended: ses.get(id) ?? 0,
          evaluationsRequired: evals.required,
          evaluationsDone: evals.done.get(id) ?? 0,
        },
      ]),
    );
  }

  private async eligibilityOf(t: TemplateRow, registrationId: string): Promise<Eligibility> {
    const reg = await this.prisma.registration.findUniqueOrThrow({ where: { id: registrationId }, select: { status: true } });
    const f = (await this.facts(t.eventId, [registrationId], t.countLate)).get(registrationId)!;
    return checkEligibility(this.rules(t), { ...f, registrationStatus: reg.status });
  }

  // ───────────── issue ─────────────

  async issue(eventId: string, dto: IssueDto, user: AuthUser, meta: RequestMeta) {
    const scoped = await this.eventAccess.assert(user, 'certificate:create', eventId);
    const t = await this.loadTemplate(dto.templateId);
    if (t.eventId !== eventId || !t.isActive) throw Errors.validation('แม่แบบเกียรติบัตรไม่ถูกต้อง');
    this.assertIssuable(scoped);
    if (dto.overrideReason && !(await this.eventAccess.can(user, 'certificate:update', scoped))) throw Errors.forbidden('ไม่มีสิทธิ์ออกเกียรติบัตรให้ผู้ที่ไม่ผ่านเกณฑ์');
    if (!dto.ids?.length && !dto.allEligible) throw Errors.validation('กรุณาเลือกผู้รับเกียรติบัตร');

    const all = await this.allCandidates(t);
    const byId = new Map(all.map((c) => [c.id, c]));
    let targets: Candidate[];
    if (dto.ids?.length) {
      const ids = [...new Set(dto.ids)];
      const missing = ids.filter((id) => !byId.has(id));
      if (missing.length) throw Errors.validation(t.audience === 'PERSONNEL' ? 'มีบุคลากรที่ไม่อยู่ในกลุ่มผู้รับของแม่แบบนี้' : 'มีรายชื่อที่ไม่ใช่ผู้ลงทะเบียนที่ยืนยันแล้วของกิจกรรมนี้');
      targets = ids.map((id) => byId.get(id)!);
      const ineligible = targets.filter((c) => !c.eligibility.eligible);
      if (ineligible.length && !dto.overrideReason) {
        throw new AppError('NOT_ELIGIBLE', `มี ${ineligible.length} รายการที่ไม่ผ่านเกณฑ์ (${ineligible[0]!.fullName}: ${ineligible[0]!.eligibility.reasons.join(', ')})`, HttpStatus.UNPROCESSABLE_ENTITY, {
          ineligible: ineligible.map((c) => ({ id: c.id, fullName: c.fullName, reasons: c.eligibility.reasons })),
        });
      }
    } else {
      targets = all.filter((c) => c.eligibility.eligible && !c.certificate);
    }
    const toIssue = targets.filter((c) => !c.certificate);
    if (toIssue.length > MAX_ISSUE) throw Errors.validation(`ออกได้ครั้งละไม่เกิน ${MAX_ISSUE} ฉบับ กรุณาแบ่งเป็นหลายชุด`);
    if (!toIssue.length) return { issued: 0, skipped: targets.length, certificates: [] };

    const e = await this.eventInfo(scoped);
    const created = await this.prisma.$transaction(
      async (tx) => {
        await this.lockTemplate(tx, t.id);
        const live = await tx.certificate.findMany({
          where: { templateId: t.id, status: 'ISSUED', OR: [{ registrationId: { in: toIssue.map((c) => c.id) } }, { personnelId: { in: toIssue.map((c) => c.id) } }] },
          select: { registrationId: true, personnelId: true },
        });
        const done = new Set(live.map((c) => c.registrationId ?? c.personnelId));
        const out = [];
        for (const c of toIssue) {
          if (done.has(c.id)) continue;
          out.push(await this.createCertificate(tx, t, e, c, 'ADMIN', user.id));
        }
        await this.audit.log(
          {
            actorId: user.id,
            action: dto.overrideReason ? 'certificate.issue_override' : 'certificate.issue',
            entityType: 'certificate_template',
            entityId: t.id,
            after: { eventId, count: out.length, numbers: out.length <= 20 ? out.map((x) => x.certificateNo) : [out[0]!.certificateNo, out.at(-1)!.certificateNo] },
            reason: dto.overrideReason ?? null,
            meta,
          },
          tx,
        );
        return out;
      },
      { timeout: 120_000 },
    );
    return { issued: created.length, skipped: targets.length - created.length, certificates: created.map((c) => ({ id: c.id, certificateNo: c.certificateNo })) };
  }

  /** A participant claims their own certificate (template allows it and they meet the rules). */
  async claim(templateId: string, registrationId: string, user: AuthUser | null, meta: RequestMeta) {
    const reg = await this.prisma.registration.findUnique({ where: { id: registrationId }, select: { id: true, userId: true, eventId: true } });
    if (!reg || (user && reg.userId !== user.id)) throw new AppError('NOT_FOUND', 'ไม่พบข้อมูลการลงทะเบียน', HttpStatus.NOT_FOUND);
    const t = await this.loadTemplate(templateId);
    if (t.eventId !== reg.eventId || !t.isActive || t.audience !== 'PARTICIPANT' || !t.allowSelfClaim) throw Errors.notFound('เกียรติบัตร');
    const scoped = await this.eventAccess.event(reg.eventId);
    this.assertIssuable(scoped);
    const existing = await this.prisma.certificate.findFirst({ where: { templateId, registrationId, status: 'ISSUED' }, select: { id: true, certificateNo: true } });
    if (existing) return existing;
    const el = await this.eligibilityOf(t, registrationId);
    if (!el.eligible) throw new AppError('NOT_ELIGIBLE', `ยังไม่ผ่านเกณฑ์การรับเกียรติบัตร: ${el.reasons.join(', ')}`, HttpStatus.UNPROCESSABLE_ENTITY, { reasons: el.reasons });
    const e = await this.eventInfo(scoped);
    return this.prisma.$transaction(async (tx) => {
      await this.lockTemplate(tx, t.id);
      const again = await tx.certificate.findFirst({ where: { templateId, registrationId, status: 'ISSUED' }, select: { id: true, certificateNo: true } });
      if (again) return again;
      const c = await this.createCertificate(tx, t, e, { kind: 'registration', id: registrationId }, 'SELF_CLAIM', user?.id ?? null);
      await this.audit.log({ actorId: user?.id ?? null, action: 'certificate.claim', entityType: 'certificate', entityId: c.id, after: { certificateNo: c.certificateNo, registrationId }, meta }, tx);
      return { id: c.id, certificateNo: c.certificateNo };
    });
  }

  async guestClaim(referenceNo: string, token: string, templateId: string, meta: RequestMeta) {
    return this.claim(templateId, await guestRegistrationId(this.prisma, referenceNo, token), null, meta);
  }

  async revoke(id: string, reason: string, user: AuthUser, meta: RequestMeta) {
    const c = await this.prisma.certificate.findUnique({ where: { id } });
    if (!c) throw Errors.notFound('เกียรติบัตร');
    await this.eventAccess.assert(user, 'certificate:void', c.eventId);
    if (c.status === 'REVOKED') throw Errors.invalidState('เกียรติบัตรนี้ถูกยกเลิกแล้ว');
    const n = await this.prisma.certificate.updateMany({ where: { id, status: 'ISSUED' }, data: { status: 'REVOKED', revokedAt: new Date(), revokedById: user.id, revokeReason: reason.trim() } });
    if (!n.count) throw Errors.invalidState('เกียรติบัตรนี้ถูกยกเลิกแล้ว');
    await this.audit.log({ actorId: user.id, action: 'certificate.revoke', entityType: 'certificate', entityId: id, before: { status: 'ISSUED' }, after: { status: 'REVOKED', certificateNo: c.certificateNo }, reason, meta });
    return { id, status: 'REVOKED' };
  }

  // ───────────── lists, files ─────────────

  async list(eventId: string, q: CertListQueryDto, user: AuthUser) {
    await this.eventAccess.assert(user, 'certificate:view', eventId);
    const where: Prisma.CertificateWhereInput = {
      eventId,
      ...(q.templateId ? { templateId: q.templateId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.search ? { OR: [{ recipientName: { contains: q.search, mode: 'insensitive' } }, { certificateNo: q.search.toUpperCase() }, { registration: { referenceNo: q.search.toUpperCase() } }] } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.certificate.findMany({
        where,
        select: {
          id: true, certificateNo: true, verifyCode: true, recipientName: true, status: true, issueMethod: true, issuedAt: true, revokedAt: true, revokeReason: true, downloadCount: true,
          template: { select: { id: true, nameTh: true } },
          registration: { select: { referenceNo: true } },
          issuedBy: { select: { displayName: true } },
        },
        orderBy: { certificateNo: q.order },
        skip: q.skip,
        take: q.perPage,
      }),
      this.prisma.certificate.count({ where }),
    ]);
    return Paginated.of(rows.map((r) => ({ ...r, verifyCode: formatVerifyCode(r.verifyCode), verifyUrl: this.verifyUrl(r.verifyCode) })), total, q);
  }

  /** One certificate as PDF: staff with certificate:view, or the recipient (signed in) while it is valid. */
  async pdf(id: string, user: AuthUser, meta: RequestMeta) {
    const c = await this.prisma.certificate.findUnique({ where: { id }, include: { registration: { select: { userId: true } }, personnel: { select: { userId: true } } } });
    if (!c) throw Errors.notFound('เกียรติบัตร');
    const own = (c.registration?.userId ?? c.personnel?.userId) === user.id;
    const staff = own ? false : await this.eventAccess.can(user, 'certificate:view', await this.eventAccess.event(c.eventId));
    if (!own && !staff) throw Errors.notFound('เกียรติบัตร');
    if (own && !staff && c.status !== 'ISSUED') throw Errors.invalidState('เกียรติบัตรนี้ถูกยกเลิกแล้ว');
    return this.render([c], meta, user.id, own ? 'certificate.download' : null);
  }

  async guestPdf(referenceNo: string, token: string, certificateId: string, meta: RequestMeta) {
    const registrationId = await guestRegistrationId(this.prisma, referenceNo, token);
    const c = await this.prisma.certificate.findUnique({ where: { id: certificateId } });
    if (!c || c.registrationId !== registrationId || c.status !== 'ISSUED') throw Errors.notFound('เกียรติบัตร');
    return this.render([c], meta, null, 'certificate.download');
  }

  async batchPdf(eventId: string, dto: BatchPdfDto, user: AuthUser, meta: RequestMeta) {
    await this.eventAccess.assert(user, 'certificate:export', eventId);
    const rows = await this.prisma.certificate.findMany({
      where: { eventId, status: 'ISSUED', ...(dto.ids?.length ? { id: { in: dto.ids } } : {}), ...(dto.templateId ? { templateId: dto.templateId } : {}) },
      orderBy: { certificateNo: 'asc' },
      take: MAX_PDF + 1,
    });
    if (!rows.length) throw Errors.validation('ไม่มีเกียรติบัตรที่จะพิมพ์');
    if (rows.length > MAX_PDF) throw Errors.validation(`รวมไฟล์ได้ครั้งละไม่เกิน ${MAX_PDF} ฉบับ กรุณาเลือกบางส่วน`);
    await this.audit.log({ actorId: user.id, action: 'certificate.batch_pdf', entityType: 'event', entityId: eventId, after: { count: rows.length }, meta });
    return this.render(rows, meta, user.id, null);
  }

  async export(eventId: string, user: AuthUser, meta: RequestMeta) {
    const e = await this.eventAccess.assert(user, 'certificate:export', eventId);
    const rows = await this.prisma.certificate.findMany({
      where: { eventId },
      include: { template: { select: { nameTh: true } }, registration: { select: { referenceNo: true, email: true } }, issuedBy: { select: { displayName: true } }, revokedBy: { select: { displayName: true } } },
      orderBy: { certificateNo: 'asc' },
    });
    const wb = new ExcelJS.Workbook();
    wb.creator = 'SRU Event Hub';
    const ws = wb.addWorksheet('ทะเบียนเกียรติบัตร');
    ws.addRow([`ทะเบียนเกียรติบัตร ${e.code} ${e.titleTh}`]).font = { bold: true, size: 14 };
    ws.addRow([]);
    ws.addRow(['ลำดับ', 'เลขที่', 'รหัสตรวจสอบ', 'ชื่อผู้รับ', 'เลขอ้างอิงการลงทะเบียน', 'อีเมล', 'แม่แบบ', 'วิธีออก', 'วันที่ออก', 'ผู้ออก', 'สถานะ', 'วันที่ยกเลิก', 'เหตุผลการยกเลิก', 'ผู้ยกเลิก']).font = { bold: true };
    rows.forEach((r, i) =>
      ws.addRow([
        i + 1, r.certificateNo, formatVerifyCode(r.verifyCode), sanitizeSpreadsheetCell(r.recipientName), r.registration?.referenceNo ?? '', sanitizeSpreadsheetCell(r.registration?.email ?? ''),
        sanitizeSpreadsheetCell(r.template.nameTh), r.issueMethod === 'SELF_CLAIM' ? 'ผู้เข้าร่วมรับเอง' : 'เจ้าหน้าที่', formatThaiDateTime(r.issuedAt), r.issuedBy?.displayName ?? '',
        r.status === 'ISSUED' ? 'ใช้ได้' : 'ยกเลิก', r.revokedAt ? formatThaiDateTime(r.revokedAt) : '', sanitizeSpreadsheetCell(r.revokeReason ?? ''), r.revokedBy?.displayName ?? '',
      ]),
    );
    [6, 18, 16, 36, 20, 28, 24, 16, 22, 20, 10, 22, 30, 20].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await this.audit.log({ actorId: user.id, action: 'certificate.export', entityType: 'event', entityId: eventId, after: { rows: rows.length }, meta });
    return new StreamableFile(buf, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', disposition: `attachment; filename="certificates-${e.code}.xlsx"` });
  }

  // ───────────── participants ─────────────

  /** Issued certificates of the signed-in user + certificates they can still claim. */
  async mine(user: AuthUser) {
    const issued = await this.prisma.certificate.findMany({
      where: { status: 'ISSUED', OR: [{ registration: { userId: user.id } }, { personnel: { userId: user.id } }] },
      select: { id: true, certificateNo: true, verifyCode: true, recipientName: true, issuedAt: true, template: { select: { nameTh: true } }, event: { select: { id: true, code: true, titleTh: true, startAt: true } } },
      orderBy: { issuedAt: 'desc' },
    });
    const regs = await this.prisma.registration.findMany({ where: { userId: user.id, status: 'CONFIRMED', event: { deletedAt: null, startAt: { lte: new Date() } } }, select: { id: true } });
    const claimable = (await Promise.all(regs.map((r) => this.claimableFor(r.id)))).flat();
    return { issued: issued.map((c) => ({ ...c, verifyCode: formatVerifyCode(c.verifyCode), verifyUrl: this.verifyUrl(c.verifyCode) })), claimable };
  }

  async guestMine(referenceNo: string, token: string) {
    const registrationId = await guestRegistrationId(this.prisma, referenceNo, token);
    const issued = await this.prisma.certificate.findMany({
      where: { registrationId, status: 'ISSUED' },
      select: { id: true, certificateNo: true, verifyCode: true, recipientName: true, issuedAt: true, template: { select: { nameTh: true } }, event: { select: { id: true, code: true, titleTh: true, startAt: true } } },
      orderBy: { issuedAt: 'desc' },
    });
    return { issued: issued.map((c) => ({ ...c, verifyCode: formatVerifyCode(c.verifyCode), verifyUrl: this.verifyUrl(c.verifyCode) })), claimable: await this.claimableFor(registrationId) };
  }

  private async claimableFor(registrationId: string) {
    const reg = await this.prisma.registration.findUniqueOrThrow({ where: { id: registrationId }, select: { id: true, eventId: true, status: true, event: { select: { id: true, code: true, titleTh: true, startAt: true, status: true } } } });
    if (reg.event.startAt > new Date() || reg.event.status === 'CANCELLED') return [];
    const templates = await this.prisma.certificateTemplate.findMany({
      where: { eventId: reg.eventId, isActive: true, audience: 'PARTICIPANT', allowSelfClaim: true, certificates: { none: { registrationId, status: 'ISSUED' } } },
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(templates.map(async (t) => ({ templateId: t.id, nameTh: t.nameTh, registrationId, event: reg.event, ...(await this.eligibilityOf(t, registrationId)) })));
  }

  // ───────────── public verification ─────────────

  async verify(raw: string, ip: string | undefined) {
    const code = normalizeVerifyCode(raw);
    const c = code
      ? await this.prisma.certificate.findUnique({
          where: { verifyCode: code },
          select: { id: true, certificateNo: true, recipientName: true, status: true, issuedAt: true, revokedAt: true, event: { select: { code: true, titleTh: true, startAt: true, endAt: true, organization: { select: { nameTh: true } } } }, template: { select: { nameTh: true } } },
        })
      : null;
    const result = !c ? 'NOT_FOUND' : c.status === 'ISSUED' ? 'VALID' : 'REVOKED';
    await this.prisma.certificateVerification.create({
      data: { certificateId: c?.id ?? null, codeTried: raw.trim().slice(0, 40), result, ipHash: ip ? hmacHex(this.ipKey, ip) : null },
    });
    if (!c) return { result };
    return {
      result,
      certificateNo: c.certificateNo,
      recipientName: c.recipientName,
      title: c.template.nameTh,
      issuedAt: c.issuedAt,
      revokedAt: c.revokedAt,
      event: { code: c.event.code, titleTh: c.event.titleTh, startAt: c.event.startAt, endAt: c.event.endAt, organizationName: c.event.organization.nameTh },
    };
  }

  // ───────────── helpers ─────────────

  private async createCertificate(tx: Tx, t: TemplateRow, e: EventInfo, c: Pick<Candidate, 'kind' | 'id'>, method: CertificateIssueMethod, actorId: string | null) {
    const subject = c.kind === 'registration'
      ? this.regVars(await tx.registration.findUniqueOrThrow({ where: { id: c.id }, include: { participantType: { select: { nameTh: true } } } }))
      : this.personnelVars(await tx.eventPersonnel.findUniqueOrThrow({ where: { id: c.id } }));
    const certificateNo = await this.seq.next(tx, 'CERT');
    const verifyCode = newVerifyCode();
    const now = new Date();
    const data = { ...this.eventVars(e), ...subject, certificateNo, verifyCode: formatVerifyCode(verifyCode), verifyUrl: this.verifyUrl(verifyCode), issueDate: formatThaiDate(now) };
    return tx.certificate.create({
      data: {
        certificateNo, verifyCode, eventId: t.eventId, templateId: t.id,
        registrationId: c.kind === 'registration' ? c.id : null,
        personnelId: c.kind === 'personnel' ? c.id : null,
        recipientName: (subject.fullName ?? '').slice(0, 400),
        data: data as Prisma.InputJsonValue,
        templateSnapshot: this.snapshot(t) as unknown as Prisma.InputJsonValue,
        issueMethod: method, issuedAt: now, issuedById: actorId,
      },
      select: { id: true, certificateNo: true },
    });
  }

  private async render(rows: { id: string; eventId: string; data: Prisma.JsonValue; templateSnapshot: Prisma.JsonValue; verifyCode: string; status: string; certificateNo: string }[], meta: RequestMeta, actorId: string | null, auditAction: string | null) {
    // Each certificate renders from its own snapshot (a batch may span template versions); backgrounds load once.
    const bgCache = new Map<string, Promise<Buffer | null>>();
    const bg = (fileId: string | null) => {
      if (!fileId) return Promise.resolve(null);
      if (!bgCache.has(fileId)) {
        bgCache.set(fileId, this.prisma.file.findUnique({ where: { id: fileId } }).then((f) => (f ? this.storage.getBytes(f.bucket, f.objectKey).catch(() => null) : null)));
      }
      return bgCache.get(fileId)!;
    };
    const subjects: CertSubject[] = [];
    for (const r of rows) {
      const spec = r.templateSnapshot as unknown as CertTemplateSpec;
      subjects.push({ spec, background: await bg(spec.backgroundFileId), vars: r.data as Record<string, string>, qr: this.verifyUrl(r.verifyCode), watermark: r.status === 'REVOKED' ? 'ยกเลิกแล้ว' : null });
    }
    const buf = await renderCertificatesPdf(subjects, { title: rows.length === 1 ? `เกียรติบัตร ${rows[0]!.certificateNo}` : `เกียรติบัตร ${rows.length} ฉบับ` });
    await this.prisma.certificate.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { downloadCount: { increment: 1 }, lastDownloadedAt: new Date() } });
    if (auditAction && rows.length === 1) await this.audit.log({ actorId, action: auditAction, entityType: 'certificate', entityId: rows[0]!.id, meta });
    const name = rows.length === 1 ? rows[0]!.certificateNo : `certificates-${rows.length}`;
    return new StreamableFile(buf, { type: 'application/pdf', disposition: `inline; filename="${name}.pdf"` });
  }

  private async lockTemplate(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM certificate_templates WHERE id = ${id}::uuid FOR UPDATE`;
  }

  private assertIssuable(e: ScopedEvent) {
    if (e.status === 'CANCELLED') throw Errors.invalidState('กิจกรรมถูกยกเลิกแล้ว');
    if (e.startAt > new Date()) throw Errors.invalidState('ออกเกียรติบัตรได้เมื่อกิจกรรมเริ่มแล้ว');
  }

  private async eventInfo(e: ScopedEvent): Promise<EventInfo> {
    const [org, schedules] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: e.organizationId }, select: { nameTh: true } }),
      this.prisma.eventSchedule.findMany({ where: { eventId: e.id }, select: { startAt: true, endAt: true } }),
    ]);
    const ms = schedules.length ? schedules.reduce((s, x) => s + (x.endAt.getTime() - x.startAt.getTime()), 0) : e.endAt.getTime() - e.startAt.getTime();
    const hours = ms > 0 && ms <= 24 * 3600_000 * (schedules.length ? 30 : 1) ? String(Math.round((ms / 3600_000) * 10) / 10) : '';
    return { ...e, organizationName: org?.nameTh ?? '', hours };
  }

  private eventVars(e: EventInfo) {
    const start = formatThaiDate(e.startAt);
    const end = formatThaiDate(e.endAt);
    return { eventTitle: e.titleTh, eventCode: e.code, eventDate: start === end ? start : `${start} – ${end}`, venue: e.venueText ?? '', organizationName: e.organizationName, hours: e.hours };
  }

  private regVars(r: { prefix: string | null; firstName: string; lastName: string; affiliation: string | null; participantType: { nameTh: string } }) {
    return { fullName: `${r.prefix ?? ''}${r.firstName} ${r.lastName}`.trim(), prefix: r.prefix ?? '', firstName: r.firstName, lastName: r.lastName, affiliation: r.affiliation ?? '', role: 'ผู้เข้าร่วม', participantType: r.participantType.nameTh };
  }

  private personnelVars(p: { prefix: string | null; firstName: string; lastName: string; affiliation: string | null; role: PersonnelRole }) {
    const role = PERSONNEL_ROLE_LABEL[p.role] ?? p.role;
    return { fullName: `${p.prefix ?? ''}${p.firstName} ${p.lastName}`.trim(), prefix: p.prefix ?? '', firstName: p.firstName, lastName: p.lastName, affiliation: p.affiliation ?? '', role, participantType: role };
  }

  private rules(t: TemplateRow) {
    return { requireAttendance: t.requireAttendance, countLate: t.countLate, minSessionPercent: t.minSessionPercent, requireEvaluation: t.requireEvaluation };
  }

  private templateData(dto: CertTemplateDto) {
    return {
      nameTh: dto.nameTh.trim(),
      audience: dto.audience,
      personnelRoles: dto.audience === 'PERSONNEL' ? [...new Set(dto.personnelRoles ?? [])] : [],
      widthMm: dto.widthMm,
      heightMm: dto.heightMm,
      backgroundColor: dto.backgroundColor ?? null,
      requireAttendance: dto.requireAttendance ?? true,
      countLate: dto.countLate ?? true,
      minSessionPercent: dto.minSessionPercent ?? null,
      requireEvaluation: dto.requireEvaluation ?? false,
      allowSelfClaim: dto.allowSelfClaim ?? true,
    };
  }

  private fieldSpecs(dto: CertTemplateDto): CertFieldSpec[] {
    return (dto.fields ?? []).map((f, i) => ({
      kind: f.kind, content: f.kind === 'QR' ? null : (f.content ?? '').trim(), xMm: f.xMm, yMm: f.yMm, wMm: f.wMm, hMm: f.hMm,
      fontSize: f.fontSize ?? 16, bold: f.bold ?? false, align: f.align ?? 'center', color: f.color ?? null, sortOrder: i,
    }));
  }

  private assertValid(t: Pick<CertTemplateSpec, 'widthMm' | 'heightMm' | 'fields'>) {
    const errors = validateCertTemplate(t);
    if (errors.length) throw Errors.validation('แม่แบบเกียรติบัตรไม่ถูกต้อง', errors);
  }

  private snapshot(t: TemplateRow): CertTemplateSpec {
    return { nameTh: t.nameTh, widthMm: t.widthMm, heightMm: t.heightMm, backgroundColor: t.backgroundColor, backgroundFileId: t.backgroundFileId, fields: t.fields as unknown as CertFieldSpec[] };
  }

  private async backgroundBytes(templateId: string, eventId: string) {
    const t = await this.prisma.certificateTemplate.findUnique({ where: { id: templateId }, include: { background: true } });
    if (!t || t.eventId !== eventId || !t.background) return null;
    return this.storage.getBytes(t.background.bucket, t.background.objectKey).catch(() => null);
  }

  private async loadTemplate(id: string) {
    const t = await this.prisma.certificateTemplate.findUnique({ where: { id } });
    if (!t) throw Errors.notFound('แม่แบบเกียรติบัตร');
    return t;
  }

  private templateDto(t: TemplateRow) {
    return {
      id: t.id, eventId: t.eventId, nameTh: t.nameTh, audience: t.audience, personnelRoles: t.personnelRoles,
      widthMm: t.widthMm, heightMm: t.heightMm, backgroundColor: t.backgroundColor, backgroundFileId: t.backgroundFileId,
      fields: t.fields as unknown as CertFieldSpec[],
      requireAttendance: t.requireAttendance, countLate: t.countLate, minSessionPercent: t.minSessionPercent, requireEvaluation: t.requireEvaluation, allowSelfClaim: t.allowSelfClaim,
      isActive: t.isActive, version: t.version, updatedAt: t.updatedAt,
    };
  }
}
