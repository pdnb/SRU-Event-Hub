import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { iso, login, PASSWORD, type Session } from './helpers';

/**
 * Evaluation forms and certificates (spec §4.10, §4.11 — P5a) over real HTTP + PostgreSQL:
 * form builder lifecycle, one answer per registrant on an anonymous form (signed-in and guest),
 * attendance gate, frozen questions, summary + export; certificate templates, eligibility rules
 * (attendance, session %, evaluation), concurrent issue, self-claim, guest download, revoke,
 * public verification and database-level immutability.
 */
let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;
let prisma: PrismaService;

let manager: Session;
let staff: Session;
let student: Session;
let lecturer: Session;
let eventId: string;
const tag = randomUUID().slice(0, 6);
const mail = (n: string) => `cert-${tag}-${n}@example.com`;
const regs: Record<string, { id: string; referenceNo: string; accessToken?: string }> = {};
let sessionIds: string[] = [];
let formId: string;
let templateId: string;
let personnelTemplateId: string;
let speakerId: string;

const url = (p: string) => `/api/v1/events/${eventId}${p}`;
const guestBody = (n: string) => ({ referenceNo: regs[n]!.referenceNo, token: regs[n]!.accessToken });
const pdfParser = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

async function guest(n: string) {
  const res = await request(http)
    .post(url('/registrations'))
    .set('Idempotency-Key', randomUUID())
    .send({ participantTypeCode: 'EXTERNAL', prefix: 'นาย', firstName: 'ผู้รับ', lastName: n, email: mail(n), affiliation: 'โรงเรียนทดสอบ', pdpaConsent: true });
  expect(res.status).toBe(201);
  regs[n] = { id: res.body.data.id, referenceNo: res.body.data.referenceNo, accessToken: res.body.data.accessToken };
}

beforeAll(async () => {
  if (!PASSWORD) throw new Error('SEED_DEMO_PASSWORD must be set for e2e tests');
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
  prisma = app.get(PrismaService);
  [manager, staff, student, lecturer] = await Promise.all(['sci.manager', 'staff', 'student', 'lecturer'].map((u) => login(http, u)));
});

afterAll(async () => {
  await app?.close();
});

describe('setup', () => {
  it('publishes an event with two sessions, takes registrations and checks people in', async () => {
    const orgs = await request(http).get('/api/v1/organizations');
    const sci = orgs.body.data.find((o: { code: string }) => o.code === 'SCI');
    const res = await manager.post('/api/v1/events', {
      titleTh: `อบรมเกียรติบัตร E2E ${tag}`,
      organizationId: sci.id,
      startAt: iso(30 / 1440),
      endAt: iso(0.3),
      registrationOpenAt: iso(-1),
      registrationCloseAt: iso(20 / 1440),
      capacity: 30,
      allowGuestRegistration: true,
      venueText: 'ห้องประชุม 1',
    });
    expect(res.status).toBe(201);
    eventId = res.body.data.id;
    expect((await manager.post(`/api/v1/events/${eventId}/submit`)).status).toBe(200);
    for (const u of ['sci.dean', 'executive']) expect((await (await login(http, u)).post(`/api/v1/events/${eventId}/approve`, { comment: 'ok' })).status).toBe(200);
    expect((await manager.post(`/api/v1/events/${eventId}/publish`)).status).toBe(200);

    const mine = await student.post(url('/registrations'), { participantTypeCode: 'STUDENT', firstName: 'นักศึกษา', lastName: 'เกียรติบัตร', email: mail('student'), pdpaConsent: true }, { 'Idempotency-Key': randomUUID() });
    expect(mine.status).toBe(201);
    regs.student = { id: mine.body.data.id, referenceNo: mine.body.data.referenceNo };
    for (const n of ['a', 'b', 'c', 'd']) await guest(n);

    for (const [i, title] of ['ช่วงเช้า', 'ช่วงบ่าย'].entries()) {
      const s = await manager.post(url('/schedules'), { title, startAt: iso((60 + i * 120) / 1440), endAt: iso((150 + i * 120) / 1440) });
      expect(s.status).toBe(201);
      sessionIds.push(s.body.data.id);
    }
    // student, a, b, c arrive (d never comes)
    for (const n of ['student', 'a', 'b', 'c']) expect((await staff.post(url('/checkin/manual'), { registrationId: regs[n]!.id })).status).toBe(200);
    // session attendance (the check-in flow itself is covered by the P4 suite): student 2/2, a 1/2, b 1/2, c 0/2
    const sessionRows = [
      ['student', 0], ['student', 1], ['a', 0], ['b', 1],
    ] as const;
    for (const [n, i] of sessionRows) {
      await prisma.attendanceRecord.create({ data: { eventId, registrationId: regs[n]!.id, scheduleId: sessionIds[i]!, status: 'PRESENT', firstCheckinAt: new Date() } });
    }
  });
});

describe('evaluation forms', () => {
  it('staff without evaluation rights cannot create; the manager gets the standard questions', async () => {
    expect((await staff.post(url('/evaluation-forms'), { titleTh: 'x' })).status).toBe(403);
    const res = await manager.post(url('/evaluation-forms'), { titleTh: 'แบบประเมินความพึงพอใจ' });
    expect(res.status).toBe(201);
    formId = res.body.data.id;
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.isAnonymous).toBe(true);
    expect(res.body.data.questions.filter((q: { kind: string }) => q.kind === 'RATING')).toHaveLength(6);
  });

  it('validates choice questions and the open/close window', async () => {
    const bad = await manager.post(url('/evaluation-forms'), { titleTh: 'x', questions: [{ kind: 'SINGLE', labelTh: 'เลือก', options: ['ก'] }] });
    expect(bad.status).toBe(422);
    const win = await manager.post(url('/evaluation-forms'), { titleTh: 'x', opensAt: iso(2), closesAt: iso(1) });
    expect(win.status).toBe(422);
  });

  it('participants cannot see a draft form', async () => {
    expect((await student.get(`/api/v1/evaluation-forms/${formId}/respond?registrationId=${regs.student!.id}`)).status).toBe(404);
  });

  it('can replace questions while nobody has answered, then publish', async () => {
    const cur = (await manager.get(`/api/v1/evaluation-forms/${formId}`)).body.data;
    const questions = [
      { kind: 'SECTION', labelTh: 'ความพึงพอใจ' },
      { kind: 'RATING', labelTh: 'ภาพรวม' },
      { kind: 'RATING', labelTh: 'วิทยากร' },
      { kind: 'SINGLE', labelTh: 'ทราบข่าวจาก', options: ['เว็บไซต์', 'เพื่อน', 'อื่น ๆ'] },
      { kind: 'MULTI', labelTh: 'หัวข้อที่สนใจ', options: ['AI', 'Data', 'Cloud'], isRequired: false },
      { kind: 'TEXTAREA', labelTh: 'ข้อเสนอแนะ', isRequired: false },
    ];
    const upd = await manager.put(`/api/v1/evaluation-forms/${formId}`, { titleTh: cur.titleTh, version: cur.version, questions });
    expect(upd.status).toBe(200);
    expect(upd.body.data.questions).toHaveLength(6);
    expect((await manager.put(`/api/v1/evaluation-forms/${formId}`, { titleTh: cur.titleTh, version: cur.version })).status).toBe(409); // stale version
    const pub = await manager.post(`/api/v1/evaluation-forms/${formId}/status`, { status: 'PUBLISHED' });
    expect(pub.status).toBe(200);
    expect(pub.body.data.status).toBe('PUBLISHED');
  });

  it('is not open before the event starts', async () => {
    const view = await student.get(`/api/v1/evaluation-forms/${formId}/respond?registrationId=${regs.student!.id}`);
    expect(view.status).toBe(200);
    expect(view.body.data.canAnswer).toBe(false);
    expect(view.body.data.reason).toContain('เปิดให้ตอบเมื่อ');
  });

  it('(the event starts)', async () => {
    await prisma.event.update({ where: { id: eventId }, data: { startAt: new Date(Date.now() - 3600_000) } });
  });

  it('a signed-in participant answers once; validation errors list each problem', async () => {
    const view = (await student.get(`/api/v1/evaluation-forms/${formId}/respond?registrationId=${regs.student!.id}`)).body.data;
    expect(view.canAnswer).toBe(true);
    const q = view.questions as { id: string; kind: string; options: { id: string }[] }[];
    const [rate1, rate2, single, multi, text] = [q[1]!, q[2]!, q[3]!, q[4]!, q[5]!];

    const bad = await student.post(`/api/v1/evaluation-forms/${formId}/responses`, { registrationId: regs.student!.id, answers: [{ questionId: rate1.id, value: 9 }] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.length).toBeGreaterThanOrEqual(3); // out of range + 2 missing required

    const answers = [
      { questionId: rate1.id, value: 5 },
      { questionId: rate2.id, value: 4 },
      { questionId: single.id, optionIds: [single.options[0]!.id] },
      { questionId: multi.id, optionIds: [multi.options[0]!.id, multi.options[2]!.id] },
      { questionId: text.id, text: 'ดีมาก' },
    ];
    const ok = await student.post(`/api/v1/evaluation-forms/${formId}/responses`, { registrationId: regs.student!.id, answers });
    expect(ok.status).toBe(201);
    const again = await student.post(`/api/v1/evaluation-forms/${formId}/responses`, { registrationId: regs.student!.id, answers });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_ANSWERED');

    // anonymous: the response does not name the registrant
    const row = await prisma.evaluationResponse.findFirstOrThrow({ where: { formId } });
    expect(row.registrationId).toBeNull();
    expect(row.respondentKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('another user cannot answer on someone else\'s registration', async () => {
    const res = await lecturer.post(`/api/v1/evaluation-forms/${formId}/responses`, { registrationId: regs.a!.id, answers: [] });
    expect(res.status).toBe(404);
  });

  it('guests answer with reference + token; two concurrent submissions record one response', async () => {
    const list = await request(http).post('/api/v1/public/registrations/evaluations').send(guestBody('a'));
    expect(list.status).toBe(200);
    expect(list.body.data[0]).toMatchObject({ formId, canAnswer: true, answered: false });

    const view = (await request(http).post(`/api/v1/public/evaluation-forms/${formId}/view`).send(guestBody('a'))).body.data;
    const q = view.questions as { id: string; kind: string; options: { id: string }[] }[];
    const answers = [
      { questionId: q[1]!.id, value: 3 },
      { questionId: q[2]!.id, value: 4 },
      { questionId: q[3]!.id, optionIds: [q[3]!.options[1]!.id] },
    ];
    const results = await Promise.all([1, 2, 3].map(() => request(http).post(`/api/v1/public/evaluation-forms/${formId}/responses`).send({ ...guestBody('a'), answers })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);

    const c = await request(http).post(`/api/v1/public/evaluation-forms/${formId}/responses`).send({ ...guestBody('c'), answers });
    expect(c.status).toBe(201);
    const wrong = await request(http).post(`/api/v1/public/evaluation-forms/${formId}/responses`).send({ referenceNo: regs.a!.referenceNo, token: 'x'.repeat(30), answers });
    expect(wrong.status).toBe(404);
  });

  it('only attendees may answer when the form requires attendance', async () => {
    const view = (await request(http).post(`/api/v1/public/evaluation-forms/${formId}/view`).send(guestBody('d'))).body.data;
    expect(view.canAnswer).toBe(false);
    expect(view.reason).toContain('เข้าร่วมกิจกรรม');
    const res = await request(http).post(`/api/v1/public/evaluation-forms/${formId}/responses`).send({ ...guestBody('d'), answers: [] });
    expect(res.status).toBe(409);
  });

  it('questions and anonymity are frozen after the first response; the form cannot be deleted', async () => {
    const cur = (await manager.get(`/api/v1/evaluation-forms/${formId}`)).body.data;
    const changed = await manager.put(`/api/v1/evaluation-forms/${formId}`, { titleTh: cur.titleTh, version: cur.version, questions: [{ kind: 'RATING', labelTh: 'ใหม่' }] });
    expect(changed.status).toBe(409);
    const anon = await manager.put(`/api/v1/evaluation-forms/${formId}`, { titleTh: cur.titleTh, version: cur.version, isAnonymous: false });
    expect(anon.status).toBe(409);
    const title = await manager.put(`/api/v1/evaluation-forms/${formId}`, { titleTh: 'แบบประเมิน (ปรับชื่อ)', version: cur.version });
    expect(title.status).toBe(200);
    expect((await request(http).delete(`/api/v1/evaluation-forms/${formId}`).set('Cookie', manager.cookies.join('; ')).set('X-CSRF-Token', manager.csrf)).status).toBe(409);
  });

  it('summarises results (mean, distribution, response rate) and exports Excel', async () => {
    const s = await manager.get(`/api/v1/evaluation-forms/${formId}/summary`);
    expect(s.status).toBe(200);
    expect(s.body.data.responses).toBe(3);
    expect(s.body.data.expected).toBe(4); // checked-in registrants
    expect(s.body.data.responseRate).toBe(75);
    const overall = s.body.data.questions.find((q: { labelTh: string }) => q.labelTh === 'ภาพรวม');
    expect(overall.mean).toBeCloseTo((5 + 3 + 3) / 3, 2);
    expect(overall.distribution.find((d: { value: number }) => d.value === 3).count).toBe(2);
    const multi = s.body.data.questions.find((q: { labelTh: string }) => q.labelTh === 'หัวข้อที่สนใจ');
    expect(multi.n).toBe(1);
    expect(multi.options.map((o: { count: number }) => o.count)).toEqual([1, 0, 1]);

    expect((await staff.get(`/api/v1/evaluation-forms/${formId}/export`)).status).toBe(403);
    const x = await manager.get(`/api/v1/evaluation-forms/${formId}/export`).buffer(true).parse(pdfParser);
    expect(x.status).toBe(200);
    expect((x.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });

  it('answers are append-only in the database', async () => {
    await expect(prisma.evaluationAnswer.deleteMany({ where: { response: { formId } } })).rejects.toThrow();
    await expect(prisma.evaluationResponse.updateMany({ where: { formId }, data: { submittedAt: new Date() } })).rejects.toThrow();
  });

  it('me/evaluations lists the form as answered', async () => {
    const res = await student.get('/api/v1/me/evaluations');
    expect(res.status).toBe(200);
    expect(res.body.data.find((f: { formId: string }) => f.formId === formId)).toMatchObject({ answered: true });
  });
});

describe('certificate templates', () => {
  it('creates a participant template from the default A4 layout with eligibility rules', async () => {
    expect((await staff.post(url('/certificate-templates'), { nameTh: 'x', audience: 'PARTICIPANT', widthMm: 297, heightMm: 210 })).status).toBe(403);
    const res = await manager.post(url('/certificate-templates'), {
      nameTh: 'เกียรติบัตรผู้เข้าร่วม', audience: 'PARTICIPANT', widthMm: 297, heightMm: 210,
      requireAttendance: true, minSessionPercent: 50, requireEvaluation: true, allowSelfClaim: true,
    });
    expect(res.status).toBe(201);
    templateId = res.body.data.id;
    expect(res.body.data.fields.length).toBeGreaterThan(4);
  });

  it('rejects layouts without the recipient name or with unknown placeholders', async () => {
    const base = { nameTh: 'x', audience: 'PARTICIPANT', widthMm: 297, heightMm: 210 };
    const field = { kind: 'TEXT', xMm: 10, yMm: 10, wMm: 100, hMm: 20 };
    expect((await manager.post(url('/certificate-templates'), { ...base, fields: [{ ...field, content: 'สวัสดี' }] })).status).toBe(422);
    expect((await manager.post(url('/certificate-templates'), { ...base, fields: [{ ...field, content: '{fullName} {secret}' }] })).status).toBe(422);
  });

  it('previews a draft as PDF', async () => {
    const t = (await manager.get(`/api/v1/certificate-templates/${templateId}`)).body.data;
    const { nameTh, audience, widthMm, heightMm, fields } = t;
    const res = await manager.post(url('/certificate-templates/preview'), { template: { nameTh, audience, widthMm, heightMm, fields }, templateId }).buffer(true).parse(pdfParser);
    expect(res.status).toBe(200);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('creates a speaker template for personnel', async () => {
    const p = await manager.post(url('/personnel'), { role: 'SPEAKER', prefix: 'ผศ.ดร.', firstName: 'วิทยากร', lastName: 'บรรยาย', affiliation: 'มหาวิทยาลัยอื่น' });
    expect(p.status).toBe(201);
    speakerId = p.body.data.id;
    await manager.post(url('/personnel'), { role: 'MEDIA', firstName: 'สื่อ', lastName: 'มวลชน' });
    const res = await manager.post(url('/certificate-templates'), { nameTh: 'เกียรติบัตรวิทยากร', audience: 'PERSONNEL', personnelRoles: ['SPEAKER'], widthMm: 297, heightMm: 210 });
    expect(res.status).toBe(201);
    personnelTemplateId = res.body.data.id;
  });
});

describe('eligibility and issuing', () => {
  it('reports eligibility per registrant with every unmet rule', async () => {
    const res = await manager.get(url(`/certificates/candidates?templateId=${templateId}&perPage=50`));
    expect(res.status).toBe(200);
    const by = Object.fromEntries(res.body.data.map((c: { id: string }) => [c.id, c]));
    expect(by[regs.student!.id].eligibility.eligible).toBe(true); // attended, 2/2, evaluated
    expect(by[regs.a!.id].eligibility.eligible).toBe(true); // attended, 1/2 = 50 %, evaluated
    expect(by[regs.b!.id].eligibility.reasons).toEqual(['ยังไม่ได้ตอบแบบประเมินกิจกรรม']);
    expect(by[regs.c!.id].eligibility.reasons[0]).toContain('0/2');
    expect(by[regs.d!.id].eligibility.reasons).toHaveLength(3); // no attendance, 0 sessions, no evaluation
    expect(res.body.meta.summary).toMatchObject({ total: 5, eligible: 2, issued: 0, pending: 2 });
  });

  it('refuses ineligible registrants unless overridden by someone allowed to', async () => {
    const res = await manager.post(url('/certificates/issue'), { templateId, ids: [regs.b!.id] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NOT_ELIGIBLE');
  });

  it('issues to everyone eligible exactly once even when requested five times at once', async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => manager.post(url('/certificates/issue'), { templateId, allEligible: true })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.reduce((s, r) => s + r.body.data.issued, 0)).toBe(2);
    const rows = await prisma.certificate.findMany({ where: { templateId }, orderBy: { certificateNo: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.certificateNo)[0]).toMatch(/^CERT-\d{4}-\d{6}$/);
    expect(new Set(rows.map((r) => r.verifyCode)).size).toBe(2);
  });

  it('issues to an ineligible registrant with an override reason (audited)', async () => {
    const res = await manager.post(url('/certificates/issue'), { templateId, ids: [regs.b!.id], overrideReason: 'ตอบแบบประเมินกระดาษแทน' });
    expect(res.status).toBe(200);
    expect(res.body.data.issued).toBe(1);
    const log = await prisma.auditLog.findFirst({ where: { action: 'certificate.issue_override', entityId: templateId } });
    expect(log?.reason).toBe('ตอบแบบประเมินกระดาษแทน');
  });

  it('personnel certificates go only to the template\'s roles', async () => {
    const cands = await manager.get(url(`/certificates/candidates?templateId=${personnelTemplateId}`));
    expect(cands.body.data.map((c: { id: string }) => c.id)).toEqual([speakerId]);
    const res = await manager.post(url('/certificates/issue'), { templateId: personnelTemplateId, allEligible: true });
    expect(res.body.data.issued).toBe(1);
  });

  it('lists, filters and exports the register', async () => {
    const list = await manager.get(url('/certificates?status=ISSUED&perPage=50'));
    expect(list.body.meta.total).toBe(4);
    expect(list.body.data[0].verifyCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const x = await manager.get(url('/certificates/export')).buffer(true).parse(pdfParser);
    expect((x.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    const all = await manager.post(url('/certificates/pdf'), { templateId }).buffer(true).parse(pdfParser);
    expect(all.status).toBe(200);
    expect(((all.body as Buffer).toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBe(3);
  });
});

describe('participants', () => {
  it('the student sees and downloads their own certificate; others cannot', async () => {
    const mine = await student.get('/api/v1/me/certificates');
    expect(mine.status).toBe(200);
    const cert = mine.body.data.issued.find((c: { event: { id: string } }) => c.event.id === eventId);
    expect(cert).toBeTruthy();
    const pdf = await student.get(`/api/v1/certificates/${cert.id}/pdf`).buffer(true).parse(pdfParser);
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await lecturer.get(`/api/v1/certificates/${cert.id}/pdf`)).status).toBe(404);
  });

  it('a guest who becomes eligible claims the certificate themselves (once)', async () => {
    // c attends a session → 1/2 = 50 % (already evaluated)
    await prisma.attendanceRecord.create({ data: { eventId, registrationId: regs.c!.id, scheduleId: sessionIds[0]!, status: 'PRESENT', firstCheckinAt: new Date() } });
    const before = await request(http).post('/api/v1/public/registrations/certificates').send(guestBody('c'));
    expect(before.status).toBe(200);
    expect(before.body.data.issued).toHaveLength(0);
    expect(before.body.data.claimable[0]).toMatchObject({ templateId, eligible: true });

    const claims = await Promise.all([1, 2].map(() => request(http).post('/api/v1/public/registrations/certificates/claim').send({ ...guestBody('c'), templateId })));
    expect(claims.every((r) => r.status === 201)).toBe(true);
    expect(claims[0]!.body.data.id).toBe(claims[1]!.body.data.id);
    expect(await prisma.certificate.count({ where: { templateId, registrationId: regs.c!.id } })).toBe(1);
    expect((await prisma.certificate.findFirstOrThrow({ where: { registrationId: regs.c!.id } })).issueMethod).toBe('SELF_CLAIM');

    const pdf = await request(http).post('/api/v1/public/registrations/certificates/pdf').send({ ...guestBody('c'), certificateId: claims[0]!.body.data.id }).buffer(true).parse(pdfParser);
    expect(pdf.status).toBe(200);
    // another guest's token cannot fetch it
    expect((await request(http).post('/api/v1/public/registrations/certificates/pdf').send({ ...guestBody('d'), certificateId: claims[0]!.body.data.id })).status).toBe(404);
  });

  it('an ineligible guest is told why and cannot claim', async () => {
    const res = await request(http).post('/api/v1/public/registrations/certificates/claim').send({ ...guestBody('d'), templateId });
    expect(res.status).toBe(422);
    expect(res.body.error.details.reasons.length).toBeGreaterThan(0);
  });
});

describe('verification and revocation', () => {
  let cert: { id: string; verifyCode: string; certificateNo: string };

  it('anyone can verify a certificate by code (format-tolerant)', async () => {
    cert = await prisma.certificate.findFirstOrThrow({ where: { registrationId: regs.a!.id } });
    const typed = `${cert.verifyCode.slice(0, 4)}-${cert.verifyCode.slice(4, 8)} ${cert.verifyCode.slice(8)}`.toLowerCase();
    const res = await request(http).get(`/api/v1/public/certificates/verify/${encodeURIComponent(typed)}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ result: 'VALID', certificateNo: cert.certificateNo, recipientName: 'นายผู้รับ a' });
    expect(res.body.data.event.titleTh).toContain(tag);
    expect(JSON.stringify(res.body.data)).not.toContain(mail('a')); // no personal data beyond the name
    const miss = await request(http).get('/api/v1/public/certificates/verify/ZZZZ-ZZZZ-ZZZZ');
    expect(miss.body.data).toEqual({ result: 'NOT_FOUND' });
    expect(await prisma.certificateVerification.count({ where: { certificateId: cert.id, result: 'VALID' } })).toBe(1);
  });

  it('revocation needs certificate:void and a reason; verify then reports REVOKED', async () => {
    expect((await staff.post(`/api/v1/certificates/${cert.id}/revoke`, { reason: 'ข้อมูลผิด' })).status).toBe(403);
    expect((await manager.post(`/api/v1/certificates/${cert.id}/revoke`, { reason: 'x' })).status).toBe(422);
    const res = await manager.post(`/api/v1/certificates/${cert.id}/revoke`, { reason: 'ชื่อสะกดผิด ออกฉบับใหม่' });
    expect(res.status).toBe(200);
    expect((await manager.post(`/api/v1/certificates/${cert.id}/revoke`, { reason: 'ซ้ำอีกครั้ง' })).status).toBe(409);
    const v = await request(http).get(`/api/v1/public/certificates/verify/${cert.verifyCode}`);
    expect(v.body.data.result).toBe('REVOKED');
  });

  it('after revocation a new certificate (new number) can be issued', async () => {
    const res = await manager.post(url('/certificates/issue'), { templateId, ids: [regs.a!.id] });
    expect(res.body.data.issued).toBe(1);
    expect(res.body.data.certificates[0].certificateNo).not.toBe(cert.certificateNo);
  });

  it('issued content cannot be altered or deleted, and a revoked certificate stays revoked', async () => {
    await expect(prisma.certificate.update({ where: { id: cert.id }, data: { recipientName: 'คนอื่น' } })).rejects.toThrow();
    await expect(prisma.certificate.update({ where: { id: cert.id }, data: { status: 'ISSUED', revokedAt: null, revokeReason: null, revokedById: null } })).rejects.toThrow();
    await expect(prisma.certificate.delete({ where: { id: cert.id } })).rejects.toThrow();
    await expect(prisma.certificateVerification.deleteMany({ where: { certificateId: cert.id } })).rejects.toThrow();
  });
});
