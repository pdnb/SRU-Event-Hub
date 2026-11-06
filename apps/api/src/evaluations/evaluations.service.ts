import { HttpStatus, Injectable, StreamableFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { formatThaiDateTime, sanitizeSpreadsheetCell } from '@sru/shared-utils';
import ExcelJS from 'exceljs';
import type { AuthUser } from '../auth/auth.types';
import { EventAccessService } from '../checkin/event-access.service';
import { AuditService } from '../common/audit.service';
import type { RequestMeta } from '../common/decorators';
import { deriveKey, hmacHex } from '../common/derived-key';
import { AppError, Errors } from '../common/errors';
import { guestRegistrationId } from '../common/guest-access';
import type { Env } from '../config/env';
import { EvaluationFormStatus, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AnswerDto, FormDto, FormUpdateDto, QuestionDto } from './evaluations.dto';

const FORM_INCLUDE = {
  questions: { orderBy: { sortOrder: 'asc' }, include: { options: { orderBy: { sortOrder: 'asc' } } } },
} satisfies Prisma.EvaluationFormInclude;
type FormRow = Prisma.EvaluationFormGetPayload<{ include: typeof FORM_INCLUDE }>;

const ATTENDED = ['PRESENT', 'LATE'] as const;
const ANSWERABLE = new Set(['RATING', 'SINGLE', 'MULTI', 'TEXT', 'TEXTAREA']);

/** Standard satisfaction survey used when a form is created without questions. */
const DEFAULT_QUESTIONS: QuestionDto[] = [
  { kind: 'SECTION', labelTh: 'ตอนที่ 1 ความพึงพอใจต่อการจัดกิจกรรม', helpText: '5 = มากที่สุด, 4 = มาก, 3 = ปานกลาง, 2 = น้อย, 1 = น้อยที่สุด' },
  { kind: 'RATING', labelTh: 'ความเหมาะสมของระยะเวลาในการจัดกิจกรรม' },
  { kind: 'RATING', labelTh: 'ความเหมาะสมของสถานที่และสิ่งอำนวยความสะดวก' },
  { kind: 'RATING', labelTh: 'ความรู้ความสามารถของวิทยากร / ผู้ดำเนินกิจกรรม' },
  { kind: 'RATING', labelTh: 'ความรู้หรือประสบการณ์ที่ได้รับจากกิจกรรม' },
  { kind: 'RATING', labelTh: 'สามารถนำความรู้ไปใช้ประโยชน์ได้' },
  { kind: 'RATING', labelTh: 'ความพึงพอใจโดยรวมต่อกิจกรรม' },
  { kind: 'SECTION', labelTh: 'ตอนที่ 2 ข้อเสนอแนะ' },
  { kind: 'TEXTAREA', labelTh: 'ข้อเสนอแนะเพิ่มเติม', isRequired: false },
];

/** Thai interpretation of a 5-point mean (common university reporting convention). */
export function ratingLevel(mean: number): string {
  if (mean >= 4.51) return 'มากที่สุด';
  if (mean >= 3.51) return 'มาก';
  if (mean >= 2.51) return 'ปานกลาง';
  if (mean >= 1.51) return 'น้อย';
  return 'น้อยที่สุด';
}

/**
 * Evaluation forms (spec §4.11). One response per registrant per form: the response row carries
 * respondent_key = HMAC(form id, registration id) under a key derived from FIELD_ENCRYPTION_KEY,
 * unique per form — so a registrant answers once even when the form is anonymous (the registration
 * id is then not stored). Questions are frozen once the first response arrives so results stay
 * comparable. Answers are append-only.
 */
@Injectable()
export class EvaluationsService {
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly eventAccess: EventAccessService,
    config: ConfigService<Env, true>,
  ) {
    this.key = deriveKey(String(config.get('FIELD_ENCRYPTION_KEY', { infer: true })), 'evaluation-respondent/v1');
  }

  respondentKey(formId: string, registrationId: string) {
    return hmacHex(this.key, `${formId}:${registrationId}`);
  }

  // ───────────── organiser: forms ─────────────

  async list(eventId: string, user: AuthUser) {
    await this.eventAccess.assert(user, 'evaluation:view', eventId);
    const rows = await this.prisma.evaluationForm.findMany({
      where: { eventId },
      include: { _count: { select: { questions: true, responses: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(({ _count, ...f }) => ({ ...f, questionCount: _count.questions, responseCount: _count.responses }));
  }

  async get(id: string, user: AuthUser) {
    const f = await this.load(id);
    await this.eventAccess.assert(user, 'evaluation:view', f.eventId);
    return this.formDto(f, await this.prisma.evaluationResponse.count({ where: { formId: id } }));
  }

  async create(eventId: string, dto: FormDto, user: AuthUser, meta: RequestMeta) {
    await this.eventAccess.assert(user, 'evaluation:create', eventId);
    const questions = dto.questions ?? DEFAULT_QUESTIONS;
    this.assertQuestions(questions);
    const window = this.window(dto);
    const f = await this.prisma.evaluationForm.create({
      data: {
        eventId,
        titleTh: dto.titleTh.trim(),
        description: dto.description?.trim() || null,
        isAnonymous: dto.isAnonymous ?? true,
        requireAttendance: dto.requireAttendance ?? true,
        requiredForCertificate: dto.requiredForCertificate ?? true,
        ...window,
        createdById: user.id,
        updatedById: user.id,
        questions: { create: questions.map((q, i) => this.questionData(q, i)) },
      },
      include: FORM_INCLUDE,
    });
    await this.audit.log({ actorId: user.id, action: 'evaluation_form.create', entityType: 'evaluation_form', entityId: f.id, after: { eventId, titleTh: f.titleTh, questions: questions.length }, meta });
    return this.formDto(f, 0);
  }

  /**
   * Optimistic lock on `version`. After the first response only the wording around the form may
   * change (title, description, window, certificate flag) — not the questions or anonymity.
   */
  async update(id: string, dto: FormUpdateDto, user: AuthUser, meta: RequestMeta) {
    const cur = await this.load(id);
    await this.eventAccess.assert(user, 'evaluation:update', cur.eventId);
    const responses = await this.prisma.evaluationResponse.count({ where: { formId: id } });
    if (responses) {
      if (dto.questions && !this.sameQuestions(cur, dto.questions)) throw Errors.invalidState('มีผู้ตอบแบบประเมินแล้ว จึงแก้ไขคำถามไม่ได้ (สร้างแบบประเมินใหม่แทน)');
      if (dto.isAnonymous !== undefined && dto.isAnonymous !== cur.isAnonymous) throw Errors.invalidState('มีผู้ตอบแบบประเมินแล้ว จึงเปลี่ยนการไม่ระบุตัวตนไม่ได้');
    }
    const replaceQuestions = !responses && !!dto.questions;
    if (replaceQuestions) this.assertQuestions(dto.questions!);
    const window = this.window(dto);
    const f = await this.prisma.$transaction(async (tx) => {
      const n = await tx.evaluationForm.updateMany({
        where: { id, version: dto.version },
        data: {
          titleTh: dto.titleTh.trim(),
          description: dto.description?.trim() || null,
          ...(responses ? {} : { isAnonymous: dto.isAnonymous ?? cur.isAnonymous }),
          requireAttendance: dto.requireAttendance ?? cur.requireAttendance,
          requiredForCertificate: dto.requiredForCertificate ?? cur.requiredForCertificate,
          ...window,
          version: { increment: 1 },
          updatedById: user.id,
        },
      });
      if (!n.count) throw Errors.conflict('VERSION_CONFLICT', 'แบบประเมินนี้ถูกแก้ไขโดยผู้อื่นแล้ว กรุณาโหลดใหม่');
      if (replaceQuestions) {
        await tx.evaluationQuestion.deleteMany({ where: { formId: id } });
        for (const [i, q] of dto.questions!.entries()) await tx.evaluationQuestion.create({ data: { formId: id, ...this.questionData(q, i) } });
      }
      return tx.evaluationForm.findUniqueOrThrow({ where: { id }, include: FORM_INCLUDE });
    });
    await this.audit.log({ actorId: user.id, action: 'evaluation_form.update', entityType: 'evaluation_form', entityId: id, before: { version: cur.version }, after: { version: f.version, questionsReplaced: replaceQuestions }, meta });
    return this.formDto(f, responses);
  }

  async setStatus(id: string, status: 'PUBLISHED' | 'CLOSED', user: AuthUser, meta: RequestMeta) {
    const cur = await this.load(id);
    await this.eventAccess.assert(user, 'evaluation:update', cur.eventId);
    if (cur.status === status) return this.formDto(cur, await this.prisma.evaluationResponse.count({ where: { formId: id } }));
    if (status === 'PUBLISHED' && !cur.questions.some((q) => ANSWERABLE.has(q.kind))) throw Errors.validation('แบบประเมินต้องมีคำถามอย่างน้อย 1 ข้อ');
    if (status === 'CLOSED' && cur.status === 'DRAFT') throw Errors.invalidState('แบบประเมินยังไม่ได้เผยแพร่');
    const f = await this.prisma.evaluationForm.update({
      where: { id },
      data: { status, ...(status === 'PUBLISHED' && !cur.publishedAt ? { publishedAt: new Date() } : {}), version: { increment: 1 }, updatedById: user.id },
      include: FORM_INCLUDE,
    });
    await this.audit.log({ actorId: user.id, action: `evaluation_form.${status === 'PUBLISHED' ? 'publish' : 'close'}`, entityType: 'evaluation_form', entityId: id, before: { status: cur.status }, after: { status }, meta });
    return this.formDto(f, await this.prisma.evaluationResponse.count({ where: { formId: id } }));
  }

  async remove(id: string, user: AuthUser, meta: RequestMeta) {
    const cur = await this.load(id);
    await this.eventAccess.assert(user, 'evaluation:update', cur.eventId);
    if (await this.prisma.evaluationResponse.count({ where: { formId: id } })) throw Errors.invalidState('มีผู้ตอบแบบประเมินแล้ว จึงลบไม่ได้ (ปิดรับแทน)');
    await this.prisma.evaluationForm.delete({ where: { id } });
    await this.audit.log({ actorId: user.id, action: 'evaluation_form.delete', entityType: 'evaluation_form', entityId: id, before: { titleTh: cur.titleTh }, meta });
    return { deleted: true };
  }

  // ───────────── organiser: results ─────────────

  async summary(id: string, user: AuthUser) {
    const f = await this.load(id);
    await this.eventAccess.assert(user, 'evaluation:view', f.eventId);
    const [responses, expected, answers] = await Promise.all([
      this.prisma.evaluationResponse.count({ where: { formId: id } }),
      this.prisma.registration.count({ where: this.expectedWhere(f) }),
      this.prisma.evaluationAnswer.findMany({
        where: { response: { formId: id } },
        select: { responseId: true, questionId: true, optionId: true, valueNumber: true, valueText: true, response: { select: { submittedAt: true } } },
      }),
    ]);
    const byQ = new Map<string, typeof answers>();
    for (const a of answers) byQ.set(a.questionId, [...(byQ.get(a.questionId) ?? []), a]);
    const questions = f.questions.map((q) => {
      const rows = byQ.get(q.id) ?? [];
      const base = { id: q.id, kind: q.kind, labelTh: q.labelTh, isRequired: q.isRequired };
      if (q.kind === 'RATING') {
        const values = rows.map((r) => r.valueNumber!).filter((v) => v != null);
        const n = values.length;
        const mean = n ? values.reduce((s, v) => s + v, 0) / n : null;
        const sd = n > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - mean!) ** 2, 0) / (n - 1)) : null;
        const distribution = Array.from({ length: q.scaleMax }, (_, i) => ({ value: i + 1, count: values.filter((v) => v === i + 1).length }));
        return { ...base, scaleMax: q.scaleMax, n, mean: mean == null ? null : round2(mean), sd: sd == null ? null : round2(sd), level: mean != null && q.scaleMax === 5 ? ratingLevel(mean) : null, distribution };
      }
      if (q.kind === 'SINGLE' || q.kind === 'MULTI') {
        const respondents = new Set(rows.map((r) => r.responseId)).size;
        return { ...base, n: respondents, options: q.options.map((o) => ({ id: o.id, labelTh: o.labelTh, count: rows.filter((r) => r.optionId === o.id).length })) };
      }
      if (q.kind === 'TEXT' || q.kind === 'TEXTAREA') {
        const texts = rows.filter((r) => r.valueText?.trim()).sort((a, b) => b.response.submittedAt.getTime() - a.response.submittedAt.getTime());
        return { ...base, n: texts.length, texts: texts.slice(0, 200).map((r) => r.valueText!) };
      }
      return base;
    });
    const ratings = questions.filter((q): q is typeof q & { mean: number; n: number } => 'mean' in q && q.mean != null);
    const overall = ratings.length ? round2(ratings.reduce((s, q) => s + q.mean, 0) / ratings.length) : null;
    return {
      form: { id: f.id, titleTh: f.titleTh, status: f.status, isAnonymous: f.isAnonymous },
      responses,
      expected,
      responseRate: expected ? round2((responses / expected) * 100) : null,
      overallMean: overall,
      overallLevel: overall != null && ratings.every((q) => 'scaleMax' in q && q.scaleMax === 5) ? ratingLevel(overall) : null,
      questions,
    };
  }

  async export(id: string, user: AuthUser, meta: RequestMeta) {
    const f = await this.load(id);
    const e = await this.eventAccess.assert(user, 'evaluation:export', f.eventId);
    const summary = await this.summary(id, user);
    const responses = await this.prisma.evaluationResponse.findMany({
      where: { formId: id },
      include: {
        answers: { select: { questionId: true, optionId: true, valueNumber: true, valueText: true } },
        registration: { select: { referenceNo: true, prefix: true, firstName: true, lastName: true, participantType: { select: { nameTh: true } } } },
      },
      orderBy: { submittedAt: 'asc' },
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'SRU Event Hub';
    const s1 = wb.addWorksheet('สรุปผล');
    s1.addRow([`แบบประเมิน: ${f.titleTh}`]).font = { bold: true, size: 14 };
    s1.addRow([`กิจกรรม: ${e.code} ${e.titleTh}`]);
    s1.addRow([`ผู้ตอบ ${summary.responses} คน จากผู้มีสิทธิ์ตอบ ${summary.expected} คน (${summary.responseRate ?? '-'}%)`]);
    if (summary.overallMean != null) s1.addRow([`ค่าเฉลี่ยรวม ${summary.overallMean.toFixed(2)}${summary.overallLevel ? ` (${summary.overallLevel})` : ''}`]);
    s1.addRow([]);
    s1.addRow(['ข้อ', 'คำถาม', 'จำนวนผู้ตอบ', 'ค่าเฉลี่ย', 'S.D.', 'ระดับ', 'รายละเอียด']).font = { bold: true };
    let no = 0;
    for (const q of summary.questions) {
      if (q.kind === 'SECTION') {
        s1.addRow(['', sanitizeSpreadsheetCell(q.labelTh)]).font = { bold: true };
        continue;
      }
      no++;
      const detail =
        'distribution' in q ? q.distribution.map((d) => `${d.value}=${d.count}`).join(', ') : 'options' in q ? q.options.map((o) => `${o.labelTh}: ${o.count}`).join(', ') : '';
      s1.addRow([
        no,
        sanitizeSpreadsheetCell(q.labelTh),
        'n' in q ? q.n : '',
        'mean' in q ? (q.mean ?? '') : '',
        'sd' in q ? (q.sd ?? '') : '',
        'level' in q ? (q.level ?? '') : '',
        sanitizeSpreadsheetCell(detail),
      ]);
    }
    s1.getColumn(2).width = 60;
    s1.getColumn(7).width = 50;

    const answerable = f.questions.filter((q) => ANSWERABLE.has(q.kind));
    const s2 = wb.addWorksheet('คำตอบรายบุคคล');
    const head = ['ลำดับ', 'เวลาที่ตอบ', ...(f.isAnonymous ? [] : ['เลขอ้างอิง', 'ชื่อ-นามสกุล', 'ประเภท']), ...answerable.map((q, i) => `${i + 1}. ${q.labelTh}`)];
    s2.addRow(head).font = { bold: true };
    const optLabel = new Map(f.questions.flatMap((q) => q.options.map((o) => [o.id, o.labelTh] as const)));
    responses.forEach((r, i) => {
      const cells = answerable.map((q) => {
        const as = r.answers.filter((a) => a.questionId === q.id);
        if (q.kind === 'RATING') return as[0]?.valueNumber ?? '';
        if (q.kind === 'SINGLE' || q.kind === 'MULTI') return sanitizeSpreadsheetCell(as.map((a) => optLabel.get(a.optionId!) ?? '').join(', '));
        return sanitizeSpreadsheetCell(as[0]?.valueText ?? '');
      });
      const who = f.isAnonymous || !r.registration ? [] : [r.registration.referenceNo, sanitizeSpreadsheetCell(`${r.registration.prefix ?? ''}${r.registration.firstName} ${r.registration.lastName}`), r.registration.participantType.nameTh];
      s2.addRow([i + 1, formatThaiDateTime(r.submittedAt), ...who, ...cells]);
    });
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await this.audit.log({ actorId: user.id, action: 'evaluation_form.export', entityType: 'evaluation_form', entityId: id, after: { responses: responses.length }, meta });
    return new StreamableFile(buf, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="evaluation-${e.code}-${id.slice(-6)}.xlsx"`,
    });
  }

  // ───────────── respondents ─────────────

  /** Published forms for the signed-in user's registrations, with whether each is answered / open. */
  async mine(user: AuthUser) {
    const regs = await this.prisma.registration.findMany({
      where: { userId: user.id, status: 'CONFIRMED', event: { deletedAt: null, evaluationForms: { some: { status: { in: ['PUBLISHED', 'CLOSED'] } } } } },
      select: { id: true },
    });
    return (await Promise.all(regs.map((r) => this.formsForRegistration(r.id)))).flat();
  }

  async guestForms(referenceNo: string, token: string) {
    return this.formsForRegistration(await guestRegistrationId(this.prisma, referenceNo, token));
  }

  /** The form to fill in, for its owner (or a guest through the access token). */
  async respondView(formId: string, registrationId: string, user: AuthUser | null) {
    if (user) await this.assertOwner(registrationId, user);
    const f = await this.load(formId);
    if (f.status === 'DRAFT') throw Errors.notFound('แบบประเมิน');
    const state = await this.respondState(f, registrationId);
    const e = await this.prisma.event.findUniqueOrThrow({ where: { id: f.eventId }, select: { code: true, titleTh: true, startAt: true, endAt: true } });
    const dto = this.formDto(f, 0);
    return { ...dto, responseCount: undefined, event: e, ...state };
  }

  async guestRespondView(formId: string, referenceNo: string, token: string) {
    return this.respondView(formId, await guestRegistrationId(this.prisma, referenceNo, token), null);
  }

  async submit(formId: string, registrationId: string, answers: AnswerDto[], user: AuthUser | null, meta: RequestMeta) {
    if (user) await this.assertOwner(registrationId, user);
    const f = await this.load(formId);
    if (f.status === 'DRAFT') throw Errors.notFound('แบบประเมิน');
    const state = await this.respondState(f, registrationId);
    if (state.answered) throw Errors.conflict('ALREADY_ANSWERED', 'ท่านตอบแบบประเมินนี้แล้ว');
    if (!state.canAnswer) throw Errors.invalidState(state.reason ?? 'ยังไม่สามารถตอบแบบประเมินได้');
    const rows = this.answerRows(f, answers);
    try {
      const res = await this.prisma.$transaction(async (tx) => {
        const r = await tx.evaluationResponse.create({
          data: { formId, eventId: f.eventId, registrationId: f.isAnonymous ? null : registrationId, respondentKey: this.respondentKey(formId, registrationId) },
        });
        if (rows.length) await tx.evaluationAnswer.createMany({ data: rows.map((a) => ({ ...a, responseId: r.id })) });
        return r;
      });
      // Anonymous forms: the audit log records only that *a* response arrived, not who sent it.
      await this.audit.log({ actorId: f.isAnonymous ? null : (user?.id ?? null), action: 'evaluation.submit', entityType: 'evaluation_form', entityId: formId, after: { anonymous: f.isAnonymous, answers: rows.length }, meta: f.isAnonymous ? undefined : meta });
      return { id: res.id, submittedAt: res.submittedAt };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw Errors.conflict('ALREADY_ANSWERED', 'ท่านตอบแบบประเมินนี้แล้ว');
      throw err;
    }
  }

  async guestSubmit(formId: string, referenceNo: string, token: string, answers: AnswerDto[], meta: RequestMeta) {
    return this.submit(formId, await guestRegistrationId(this.prisma, referenceNo, token), answers, null, meta);
  }

  // ───────────── used by certificates ─────────────

  /** For each registration: how many required (published) forms of the event exist and how many it answered. */
  async completion(eventId: string, registrationIds: string[]): Promise<{ required: number; done: Map<string, number> }> {
    const forms = await this.prisma.evaluationForm.findMany({
      where: { eventId, requiredForCertificate: true, status: { in: ['PUBLISHED', 'CLOSED'] } },
      select: { id: true },
    });
    const done = new Map<string, number>();
    if (!forms.length || !registrationIds.length) return { required: forms.length, done };
    const keyToReg = new Map<string, string>();
    for (const f of forms) for (const r of registrationIds) keyToReg.set(this.respondentKey(f.id, r), r);
    const keys = [...keyToReg.keys()];
    for (let i = 0; i < keys.length; i += 5000) {
      const hits = await this.prisma.evaluationResponse.findMany({
        where: { formId: { in: forms.map((f) => f.id) }, respondentKey: { in: keys.slice(i, i + 5000) } },
        select: { respondentKey: true },
      });
      for (const h of hits) {
        const reg = keyToReg.get(h.respondentKey)!;
        done.set(reg, (done.get(reg) ?? 0) + 1);
      }
    }
    return { required: forms.length, done };
  }

  // ───────────── helpers ─────────────

  private async formsForRegistration(registrationId: string) {
    const reg = await this.prisma.registration.findUniqueOrThrow({
      where: { id: registrationId },
      select: { id: true, referenceNo: true, event: { select: { id: true, code: true, titleTh: true, startAt: true, endAt: true } } },
    });
    const forms = await this.prisma.evaluationForm.findMany({ where: { eventId: reg.event.id, status: { in: ['PUBLISHED', 'CLOSED'] } }, include: FORM_INCLUDE, orderBy: { createdAt: 'asc' } });
    return Promise.all(
      forms.map(async (f) => ({
        formId: f.id,
        titleTh: f.titleTh,
        status: f.status,
        requiredForCertificate: f.requiredForCertificate,
        closesAt: f.closesAt,
        registrationId: reg.id,
        referenceNo: reg.referenceNo,
        event: reg.event,
        ...(await this.respondState(f, reg.id)),
      })),
    );
  }

  private async respondState(f: FormRow, registrationId: string): Promise<{ answered: boolean; canAnswer: boolean; reason: string | null; opensAt: Date }> {
    const reg = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      select: { eventId: true, status: true, event: { select: { startAt: true } }, attendance: { where: { scheduleId: null }, select: { status: true } } },
    });
    if (!reg || reg.eventId !== f.eventId) throw Errors.notFound('แบบประเมิน');
    const opensAt = f.opensAt ?? reg.event.startAt;
    const answered = !!(await this.prisma.evaluationResponse.findUnique({ where: { formId_respondentKey: { formId: f.id, respondentKey: this.respondentKey(f.id, registrationId) } }, select: { id: true } }));
    const now = new Date();
    let reason: string | null = null;
    if (answered) reason = 'ตอบแบบประเมินแล้ว';
    else if (reg.status !== 'CONFIRMED') reason = 'การลงทะเบียนยังไม่ได้รับการยืนยัน';
    else if (f.status === EvaluationFormStatus.CLOSED || (f.closesAt && now > f.closesAt)) reason = 'ปิดรับแบบประเมินแล้ว';
    else if (now < opensAt) reason = `เปิดให้ตอบเมื่อ ${formatThaiDateTime(opensAt)}`;
    else if (f.requireAttendance && !ATTENDED.includes((reg.attendance[0]?.status ?? '') as (typeof ATTENDED)[number])) reason = 'ตอบได้เฉพาะผู้ที่เข้าร่วมกิจกรรม (เช็กอินแล้ว)';
    return { answered, canAnswer: !reason, reason: answered ? null : reason, opensAt };
  }

  /** Checks answers against the form and turns them into rows (one per chosen option for MULTI). */
  private answerRows(f: FormRow, answers: AnswerDto[]) {
    const given = new Map<string, AnswerDto>();
    for (const a of answers) {
      if (given.has(a.questionId)) throw Errors.validation('ตอบคำถามเดียวกันซ้ำ');
      given.set(a.questionId, a);
    }
    const known = new Set(f.questions.map((q) => q.id));
    if ([...given.keys()].some((k) => !known.has(k))) throw Errors.validation('มีคำตอบที่ไม่ใช่คำถามในแบบประเมินนี้');
    const errors: string[] = [];
    const rows: { questionId: string; optionId?: string; valueNumber?: number; valueText?: string }[] = [];
    let no = 0;
    for (const q of f.questions) {
      if (!ANSWERABLE.has(q.kind)) continue;
      no++;
      const a = given.get(q.id);
      const label = `ข้อ ${no}`;
      if (q.kind === 'RATING') {
        if (a?.value == null) {
          if (q.isRequired) errors.push(`${label}: กรุณาให้คะแนน`);
          continue;
        }
        if (a.value < 1 || a.value > q.scaleMax) errors.push(`${label}: คะแนนต้องอยู่ระหว่าง 1–${q.scaleMax}`);
        else rows.push({ questionId: q.id, valueNumber: a.value });
      } else if (q.kind === 'SINGLE' || q.kind === 'MULTI') {
        const ids = [...new Set(a?.optionIds ?? [])];
        if (!ids.length) {
          if (q.isRequired) errors.push(`${label}: กรุณาเลือกคำตอบ`);
          continue;
        }
        if (q.kind === 'SINGLE' && ids.length > 1) errors.push(`${label}: เลือกได้ 1 คำตอบ`);
        const valid = new Set(q.options.map((o) => o.id));
        if (ids.some((id) => !valid.has(id))) errors.push(`${label}: ตัวเลือกไม่ถูกต้อง`);
        else ids.forEach((id) => rows.push({ questionId: q.id, optionId: id }));
      } else {
        const text = a?.text?.trim() ?? '';
        if (!text) {
          if (q.isRequired) errors.push(`${label}: กรุณากรอกคำตอบ`);
          continue;
        }
        if (q.kind === 'TEXT' && text.length > 500) errors.push(`${label}: ยาวเกิน 500 ตัวอักษร`);
        else rows.push({ questionId: q.id, valueText: text });
      }
    }
    if (errors.length) throw Errors.validation('กรุณาตรวจสอบคำตอบ', errors);
    return rows;
  }

  private assertQuestions(qs: QuestionDto[]) {
    const errors: string[] = [];
    if (!qs.some((q) => ANSWERABLE.has(q.kind))) errors.push('ต้องมีคำถามอย่างน้อย 1 ข้อ');
    qs.forEach((q, i) => {
      const opts = (q.options ?? []).map((o) => o.trim()).filter(Boolean);
      if ((q.kind === 'SINGLE' || q.kind === 'MULTI') && opts.length < 2) errors.push(`คำถามที่ ${i + 1}: ต้องมีตัวเลือกอย่างน้อย 2 ตัวเลือก`);
      if (new Set(opts).size !== opts.length) errors.push(`คำถามที่ ${i + 1}: ตัวเลือกซ้ำกัน`);
    });
    if (errors.length) throw Errors.validation('แบบประเมินไม่ถูกต้อง', errors);
  }

  private questionData(q: QuestionDto, i: number) {
    const choice = q.kind === 'SINGLE' || q.kind === 'MULTI';
    return {
      kind: q.kind,
      labelTh: q.labelTh.trim(),
      helpText: q.helpText?.trim() || null,
      isRequired: q.kind === 'SECTION' ? false : (q.isRequired ?? true),
      scaleMax: q.kind === 'RATING' ? (q.scaleMax ?? 5) : 5,
      sortOrder: i,
      options: choice ? { create: (q.options ?? []).map((o) => o.trim()).filter(Boolean).map((labelTh, j) => ({ labelTh, sortOrder: j })) } : undefined,
    };
  }

  private sameQuestions(cur: FormRow, qs: QuestionDto[]) {
    if (cur.questions.length !== qs.length) return false;
    return cur.questions.every((c, i) => {
      const q = qs[i]!;
      const opts = (q.options ?? []).map((o) => o.trim()).filter(Boolean);
      return (
        c.kind === q.kind &&
        c.labelTh === q.labelTh.trim() &&
        (c.helpText ?? null) === (q.helpText?.trim() || null) &&
        (c.kind === 'SECTION' || c.isRequired === (q.isRequired ?? true)) &&
        (c.kind !== 'RATING' || c.scaleMax === (q.scaleMax ?? 5)) &&
        c.options.length === (c.kind === 'SINGLE' || c.kind === 'MULTI' ? opts.length : 0) &&
        c.options.every((o, j) => o.labelTh === opts[j])
      );
    });
  }

  private window(dto: FormDto) {
    const opensAt = dto.opensAt ? new Date(dto.opensAt) : null;
    const closesAt = dto.closesAt ? new Date(dto.closesAt) : null;
    if (opensAt && closesAt && opensAt >= closesAt) throw Errors.validation('เวลาปิดรับต้องหลังเวลาเปิดรับ');
    return { opensAt, closesAt };
  }

  private expectedWhere(f: { eventId: string; requireAttendance: boolean }): Prisma.RegistrationWhereInput {
    return {
      eventId: f.eventId,
      status: 'CONFIRMED',
      ...(f.requireAttendance ? { attendance: { some: { scheduleId: null, status: { in: [...ATTENDED] } } } } : {}),
    };
  }

  private async assertOwner(registrationId: string, user: AuthUser) {
    const reg = await this.prisma.registration.findUnique({ where: { id: registrationId }, select: { userId: true } });
    if (!reg || reg.userId !== user.id) throw new AppError('NOT_FOUND', 'ไม่พบข้อมูลการลงทะเบียน', HttpStatus.NOT_FOUND);
  }

  private async load(id: string) {
    const f = await this.prisma.evaluationForm.findUnique({ where: { id }, include: FORM_INCLUDE });
    if (!f) throw Errors.notFound('แบบประเมิน');
    return f;
  }

  private formDto(f: FormRow, responseCount: number) {
    return {
      id: f.id,
      eventId: f.eventId,
      titleTh: f.titleTh,
      description: f.description,
      status: f.status,
      isAnonymous: f.isAnonymous,
      requireAttendance: f.requireAttendance,
      requiredForCertificate: f.requiredForCertificate,
      opensAt: f.opensAt,
      closesAt: f.closesAt,
      publishedAt: f.publishedAt,
      version: f.version,
      updatedAt: f.updatedAt,
      responseCount,
      questions: f.questions.map((q) => ({
        id: q.id,
        kind: q.kind,
        labelTh: q.labelTh,
        helpText: q.helpText,
        isRequired: q.isRequired,
        scaleMax: q.scaleMax,
        options: q.options.map((o) => ({ id: o.id, labelTh: o.labelTh })),
      })),
    };
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
