import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { createApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { iso, login, PASSWORD, type Session } from './helpers';

/**
 * Check-in, attendance and badges (spec §4.8, §4.8.1, §4.9 — P4) over real HTTP + PostgreSQL +
 * Socket.IO: QR issue/lookup, scan + duplicate guard (incl. a concurrent race), check-in window,
 * revocation, sessions & points, undo, check-out, offline sync, group QR + group check-in,
 * attendance overrides/export, live stats, personnel and badge printing / reprint control.
 */
let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;
let baseUrl: string;
let prisma: PrismaService;

let manager: Session;
let staff: Session;
let student: Session;
let lecturer: Session;
let coordinator: Session;
let eventId: string;
const tag = randomUUID().slice(0, 6);
const mail = (n: string) => `ck-${tag}-${n}@example.com`;
const regs: Record<string, { id: string; referenceNo: string; accessToken?: string }> = {};
let studentQr: string;
let scheduleId: string;
let locationId: string;
let groupId: string;
let templateId: string;

const url = (p: string) => `/api/v1/events/${eventId}${p}`;
const scan = (s: Session, code: string, extra: object = {}) => s.post(url('/checkin/scan'), { code, ...extra });

async function guest(n: string) {
  const res = await request(http)
    .post(url('/registrations'))
    .set('Idempotency-Key', randomUUID())
    .send({ participantTypeCode: 'EXTERNAL', firstName: 'ผู้เข้าร่วม', lastName: n, email: mail(n), affiliation: 'โรงเรียนทดสอบ', pdpaConsent: true });
  expect(res.status).toBe(201);
  regs[n] = { id: res.body.data.id, referenceNo: res.body.data.referenceNo, accessToken: res.body.data.accessToken };
  return regs[n]!;
}
const qrOf = async (n: string) => (await request(http).post('/api/v1/public/registrations/checkin-qr').send({ referenceNo: regs[n]!.referenceNo, token: regs[n]!.accessToken })).body.data.code as string;

beforeAll(async () => {
  if (!PASSWORD) throw new Error('SEED_DEMO_PASSWORD must be set for e2e tests');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  http = app.getHttpServer();
  baseUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  prisma = app.get(PrismaService);
  [manager, staff, student, lecturer, coordinator] = await Promise.all(['sci.manager', 'staff', 'student', 'lecturer', 'coordinator'].map((u) => login(http, u)));
});

afterAll(async () => {
  await app?.close();
});

describe('setup', () => {
  it('publishes a free event starting in 30 minutes and takes registrations', async () => {
    const orgs = await request(http).get('/api/v1/organizations');
    const sci = orgs.body.data.find((o: { code: string }) => o.code === 'SCI');
    const res = await manager.post('/api/v1/events', {
      titleTh: `สัมมนาเช็กอิน E2E ${tag}`,
      organizationId: sci.id,
      startAt: iso(30 / 1440),
      endAt: iso(0.25),
      registrationOpenAt: iso(-1),
      registrationCloseAt: iso(20 / 1440),
      capacity: 40,
      allowGuestRegistration: true,
    });
    expect(res.status).toBe(201);
    eventId = res.body.data.id;
    expect((await manager.post(`/api/v1/events/${eventId}/submit`)).status).toBe(200);
    for (const u of ['sci.dean', 'executive']) expect((await (await login(http, u)).post(`/api/v1/events/${eventId}/approve`, { comment: 'ok' })).status).toBe(200);
    expect((await manager.post(`/api/v1/events/${eventId}/publish`)).status).toBe(200);

    const mine = await student.post(url('/registrations'), { participantTypeCode: 'STUDENT', firstName: 'นักศึกษา', lastName: 'ทดสอบ', email: mail('student'), pdpaConsent: true }, { 'Idempotency-Key': randomUUID() });
    expect(mine.status).toBe(201);
    regs.student = { id: mine.body.data.id, referenceNo: mine.body.data.referenceNo };
    for (const n of ['a', 'b', 'c', 'd', 'e']) await guest(n);
  });
});

describe('QR credentials', () => {
  it('the registrant sees the same QR every time; other users cannot', async () => {
    const r1 = await student.get(`/api/v1/registrations/${regs.student!.id}/checkin-qr`);
    expect(r1.status).toBe(200);
    expect(r1.body.data.code).toMatch(/^SRU1\.[A-Za-z0-9_-]{22}$/);
    studentQr = r1.body.data.code;
    expect((await student.get(`/api/v1/registrations/${regs.student!.id}/checkin-qr`)).body.data.code).toBe(studentQr);
    expect((await lecturer.get(`/api/v1/registrations/${regs.student!.id}/checkin-qr`)).status).toBe(403);
    // only the hash is stored
    const row = await prisma.checkinToken.findFirstOrThrow({ where: { registrationId: regs.student!.id } });
    expect(row.tokenHash).not.toContain(studentQr.slice(5));
  });

  it('a guest gets the QR with reference + access token (no enumeration)', async () => {
    expect(await qrOf('a')).toMatch(/^SRU1\./);
    const wrong = await request(http).post('/api/v1/public/registrations/checkin-qr').send({ referenceNo: regs.a!.referenceNo, token: 'nope' });
    expect(wrong.status).toBe(404);
  });
});

describe('desk check-in', () => {
  it('requires check-in permission on the event', async () => {
    expect((await student.post(url('/checkin/scan'), { code: studentQr })).status).toBe(403);
  });

  it('rejects scans outside the check-in window', async () => {
    expect((await manager.put(url('/checkin/settings'), { opensBeforeMinutes: 0, lateAfterMinutes: null })).status).toBe(200);
    const res = await scan(staff, studentQr);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CHECKIN_NOT_OPEN');
    expect(res.body.error.details.registration.referenceNo).toBe(regs.student!.referenceNo); // desk still sees who it is
    expect((await manager.put(url('/checkin/settings'), { opensBeforeMinutes: 120, lateAfterMinutes: 15 })).status).toBe(200);
  });

  it('checks in once; a second scan reports "already checked in"', async () => {
    const first = await scan(staff, studentQr);
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ kind: 'REGISTRATION', outcome: 'CHECKED_IN', registration: { referenceNo: regs.student!.referenceNo, status: 'CONFIRMED' } });
    expect(first.body.data.attendance.status).toBe('PRESENT'); // before start → not late
    const again = await scan(staff, ` ${studentQr}\n`);
    expect(again.body.data.outcome).toBe('ALREADY_CHECKED_IN');
    expect(await prisma.checkinRecord.count({ where: { registrationId: regs.student!.id } })).toBe(1);
  });

  it('the same QR scanned at five desks at once is recorded exactly once', async () => {
    const code = await qrOf('b');
    const results = await Promise.all(Array.from({ length: 5 }, () => scan(staff, code)));
    const outcomes = results.map((r) => r.body.data?.outcome);
    expect(outcomes.filter((o) => o === 'CHECKED_IN')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'ALREADY_CHECKED_IN')).toHaveLength(4);
    expect(await prisma.checkinRecord.count({ where: { registrationId: regs.b!.id } })).toBe(1);
    expect(await prisma.attendanceRecord.count({ where: { registrationId: regs.b!.id } })).toBe(1);
  });

  it('rejects codes that are not check-in QRs', async () => {
    expect((await scan(staff, 'https://example.com')).body.error.code).toBe('INVALID_QR');
    expect((await scan(staff, `SRU1.${'A'.repeat(22)}`)).body.error.code).toBe('QR_NOT_FOUND');
  });

  it('a reissued QR invalidates the old one', async () => {
    const old = await qrOf('c');
    expect((await staff.post(`/api/v1/registrations/${regs.c!.id}/checkin-qr/reissue`, { reason: 'x' })).status).toBe(422);
    const re = await manager.post(`/api/v1/registrations/${regs.c!.id}/checkin-qr/reissue`, { reason: 'ผู้เข้าร่วมแจ้งว่าภาพ QR ถูกส่งต่อ' });
    expect(re.status).toBe(200);
    expect(re.body.data.code).not.toBe(old);
    expect((await scan(staff, old)).body.error.code).toBe('QR_REVOKED');
    expect((await scan(staff, re.body.data.code)).body.data.outcome).toBe('CHECKED_IN');
  });

  it('manual check-in by search, then check-out', async () => {
    const found = await staff.get(url(`/checkin/search?q=${encodeURIComponent(regs.d!.referenceNo)}`));
    expect(found.body.data).toHaveLength(1);
    expect(found.body.data[0].attendance).toBeNull();
    const m = await staff.post(url('/checkin/manual'), { registrationId: regs.d!.id, note: 'ลืมโทรศัพท์' });
    expect(m.body.data.outcome).toBe('CHECKED_IN');
    expect((await staff.post(url('/checkin/manual'), { registrationId: regs.e!.id, action: 'CHECK_OUT' })).body.error.code).toBe('NOT_CHECKED_IN');
    const out = await staff.post(url('/checkin/manual'), { registrationId: regs.d!.id, action: 'CHECK_OUT' });
    expect(out.body.data.outcome).toBe('CHECKED_OUT');
    expect(out.body.data.attendance.lastCheckoutAt).toBeTruthy();
  });
});

describe('sessions, points and undo', () => {
  it('organizer adds a session and a check-in point bound to it', async () => {
    const s = await manager.post(url('/schedules'), { title: 'Workshop ช่วงบ่าย', startAt: iso(60 / 1440), endAt: iso(0.2) });
    expect(s.status).toBe(201);
    scheduleId = s.body.data.id;
    expect((await staff.post(url('/schedules'), { title: 'x', startAt: iso(0.1), endAt: iso(0.2) })).status).toBe(403);
    const l = await manager.post(url('/checkin/locations'), { nameTh: `ห้อง Workshop ${tag}`, scheduleId });
    expect(l.status).toBe(201);
    locationId = l.body.data.id;
    expect((await manager.post(url('/checkin/locations'), { nameTh: `ห้อง Workshop ${tag}` })).status).toBe(409);
  });

  it('a scan at the session point records session + whole-event attendance', async () => {
    const res = await scan(staff, await qrOf('e'), { locationId });
    expect(res.body.data).toMatchObject({ outcome: 'CHECKED_IN', scheduleId, locationId });
    const rows = await prisma.attendanceRecord.findMany({ where: { registrationId: regs.e!.id } });
    expect(rows.map((r) => r.scheduleId).sort()).toEqual([null, scheduleId].sort());
    // already present at the event-level desk
    expect((await scan(staff, await qrOf('e'))).body.data.outcome).toBe('ALREADY_CHECKED_IN');
  });

  it('undo removes derived attendance; cannot undo twice', async () => {
    const rec = await prisma.checkinRecord.findFirstOrThrow({ where: { registrationId: regs.e!.id, action: 'CHECK_IN' } });
    expect((await staff.post(`/api/v1/checkin/records/${rec.id}/undo`, { reason: 'สแกนผิดคน' })).status).toBe(200);
    expect(await prisma.attendanceRecord.count({ where: { registrationId: regs.e!.id } })).toBe(0);
    expect((await staff.post(`/api/v1/checkin/records/${rec.id}/undo`, { reason: 'ซ้ำ' })).status).toBe(409);
    // records are append-only
    await expect(prisma.checkinRecord.delete({ where: { id: rec.id } })).rejects.toThrow();
  });
});

describe('offline sync', () => {
  it('replays captures idempotently and refuses implausible times', async () => {
    const key = `off-${randomUUID()}`;
    const item = { clientKey: key, registrationId: regs.e!.id, occurredAt: new Date(Date.now() - 5 * 60_000).toISOString() };
    const r1 = await staff.post(url('/checkin/sync'), { items: [item, { clientKey: `off-${randomUUID()}`, registrationId: regs.a!.id, occurredAt: iso(1) }] });
    expect(r1.status).toBe(200);
    expect(r1.body.data.results[0].outcome).toBe('CHECKED_IN');
    expect(r1.body.data.results[1].error.code).toBe('VALIDATION_ERROR');
    const r2 = await staff.post(url('/checkin/sync'), { items: [item] });
    expect(r2.body.data.results[0].outcome).toBe('DUPLICATE');
    const rec = await prisma.checkinRecord.findUniqueOrThrow({ where: { clientKey: key } });
    expect(rec.method).toBe('OFFLINE');
    expect(rec.occurredAt.toISOString()).toBe(item.occurredAt);
  });

  it('the offline pack carries token hashes, not tokens', async () => {
    const pack = await staff.get(url('/checkin/offline-pack'));
    expect(pack.status).toBe(200);
    const me = pack.body.data.registrants.find((r: { id: string }) => r.id === regs.student!.id);
    expect(me.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(pack.body.data)).not.toContain(studentQr.slice(5));
    expect(me.checkedInAt).toBeTruthy();
  });
});

describe('group check-in', () => {
  it('a submitted group gets one QR; scanning it lists members; selected members check in together', async () => {
    expect((await manager.put(url('/group-settings'), { isEnabled: true, minMembers: 2, maxMembers: 5, allowImport: true, allowInviteLinks: true })).status).toBe(200);
    const org = await coordinator.post('/api/v1/participant-orgs', { nameTh: `โรงเรียนเช็กอิน ${tag}`, orgType: 'SCHOOL' });
    const g = await coordinator.post(url('/groups'), { participantOrganizationId: org.body.data.id, name: 'คณะครู' }, { 'Idempotency-Key': randomUUID() });
    groupId = g.body.data.id;
    for (const n of ['g1', 'g2', 'g3']) {
      expect((await coordinator.post(`/api/v1/groups/${groupId}/members`, { participantTypeCode: 'EXTERNAL', firstName: 'ครู', lastName: n, email: mail(n) })).status).toBe(201);
    }
    expect((await coordinator.get(`/api/v1/groups/${groupId}/checkin-qr`)).status).toBe(409); // draft
    expect((await coordinator.post(`/api/v1/groups/${groupId}/submit`, { pdpaAttestation: true }, { 'Idempotency-Key': randomUUID() })).status).toBe(200);

    const qr = await coordinator.get(`/api/v1/groups/${groupId}/checkin-qr`);
    expect(qr.status).toBe(200);
    const roster = await scan(staff, qr.body.data.code);
    expect(roster.body.data.kind).toBe('GROUP');
    expect(roster.body.data.group.members).toHaveLength(3);
    const ids = roster.body.data.group.members.map((m: { id: string }) => m.id);
    const res = await staff.post(url('/checkin/group'), { groupId, registrationIds: ids.slice(0, 2) });
    expect(res.body.data.checkedIn).toBe(2);
    expect(res.body.data.group.members.filter((m: { attendance: unknown }) => m.attendance)).toHaveLength(2);
    expect((await staff.post(url('/checkin/group'), { groupId, registrationIds: [regs.a!.id] })).status).toBe(422); // not a member
  });
});

describe('attendance', () => {
  it('lists with a summary; manual status needs attendance:update and a note', async () => {
    const list = await manager.get(url('/attendance?perPage=100'));
    expect(list.status).toBe(200);
    // student, b, c, d, e (offline), g1, g2 present; a + g3 absent
    expect(list.body.meta.summary).toMatchObject({ confirmed: 9, present: 7, absent: 2 });
    expect((await staff.put(url(`/attendance/${regs.a!.id}`), { status: 'EXCUSED', note: 'ลาป่วย' })).status).toBe(403);
    const set = await manager.put(url(`/attendance/${regs.a!.id}`), { status: 'EXCUSED', note: 'ลาป่วย มีใบรับรองแพทย์' });
    expect(set.status).toBe(200);
    expect(set.body.data).toMatchObject({ status: 'EXCUSED', isManual: true });
    const absent = await manager.get(url('/attendance?status=ABSENT'));
    expect(absent.body.data.map((r: { referenceNo: string }) => r.referenceNo)).not.toContain(regs.a!.referenceNo);
    // a real scan overrides the manual "excused"
    expect((await scan(staff, await qrOf('a'))).body.data.attendance.status).toBe('PRESENT');
  });

  it('exports Excel', async () => {
    const res = await manager.get(url('/attendance/export')).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });
});

describe('real-time + stats', () => {
  it('a subscribed dashboard is notified of scans; strangers cannot subscribe', async () => {
    const connect = (cookies: string[]) =>
      new Promise<Socket>((resolve, reject) => {
        const s = io(`${baseUrl}/checkin`, { path: '/socket.io', transports: ['websocket'], extraHeaders: { Cookie: cookies.join('; ') }, reconnection: false });
        s.on('connect', () => resolve(s));
        s.on('connect_error', reject);
      });
    const dash = await connect(manager.cookies);
    const other = await connect(student.cookies);
    try {
      expect(await dash.emitWithAck('subscribe', { eventId })).toEqual({ ok: true });
      expect(await other.emitWithAck('subscribe', { eventId })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
      const got = new Promise<{ eventId: string; kind: string }>((resolve) => dash.once('checkin', resolve));
      await staff.post(url('/checkin/group'), { groupId, registrationIds: [(await prisma.registration.findFirstOrThrow({ where: { groupId, lastName: 'g3' } })).id] });
      expect(await got).toMatchObject({ eventId, kind: 'CHECK_IN' });
    } finally {
      dash.close();
      other.close();
    }
    // an unauthenticated socket is dropped by the server
    const anon = io(`${baseUrl}/checkin`, { path: '/socket.io', transports: ['websocket'], reconnection: false });
    await new Promise<void>((resolve) => anon.on('disconnect', () => resolve()));
    anon.close();
  });

  it('stats add up', async () => {
    const s = await staff.get(url('/checkin/stats'));
    expect(s.status).toBe(200);
    expect(s.body.data).toMatchObject({ confirmed: 9, checkedIn: 9, notArrived: 0 });
    expect(s.body.data.bySchedule.find((x: { id: string }) => x.id === scheduleId).count).toBe(0); // e's session check-in was undone
    expect(s.body.data.recent.length).toBeGreaterThan(0);
    expect(s.body.data.byLocation.some((l: { id: string }) => l.id === locationId)).toBe(true);
  });
});

type Tpl = { nameTh: string; paper: string; widthMm: number; heightMm: number; backgroundColor: string | null; fields: Record<string, unknown>[]; colorRules: Record<string, unknown>[] };
/** The designer sends only the editable shape (the API rejects unknown properties). */
const clean = (t: Tpl) => ({
  nameTh: t.nameTh, paper: t.paper, widthMm: t.widthMm, heightMm: t.heightMm, backgroundColor: t.backgroundColor,
  fields: t.fields.map(({ sortOrder: _s, ...f }) => f),
  colorRules: t.colorRules.map(({ sortOrder: _s, ...r }) => r),
});

describe('personnel & badges', () => {
  let speakerId: string;

  it('organizer registers a speaker; desk staff cannot', async () => {
    expect((await staff.post(url('/personnel'), { role: 'SPEAKER', firstName: 'วิทยากร', lastName: 'รับเชิญ' })).status).toBe(403);
    expect((await manager.post(url('/personnel'), { role: 'STAFF', firstName: 'x', lastName: 'y', canCheckin: true })).status).toBe(422); // needs a user
    const p = await manager.post(url('/personnel'), { role: 'SPEAKER', prefix: 'ศ.ดร.', firstName: 'วิทยากร', lastName: 'รับเชิญ', affiliation: 'มหาวิทยาลัยอื่น' });
    expect(p.status).toBe(201);
    speakerId = p.body.data.id;
  });

  it('creates a template from the default layout and validates layouts', async () => {
    const bad = await manager.post(url('/badge-templates'), {
      nameTh: 'ผิด', paper: 'A4_SHEET', widthMm: 90, heightMm: 55,
      fields: [{ kind: 'QR', xMm: 80, yMm: 0, wMm: 8, hMm: 8 }],
    });
    expect(bad.status).toBe(422);
    const t = await manager.post(url('/badge-templates'), { nameTh: 'ป้ายมาตรฐาน', paper: 'A4_SHEET', widthMm: 90, heightMm: 120 });
    expect(t.status).toBe(201);
    expect(t.body.data).toMatchObject({ isDefault: true, perSheet: 4 }); // 90×120 → 2×2 on A4
    expect(t.body.data.fields.some((f: { kind: string }) => f.kind === 'QR')).toBe(true);
    templateId = t.body.data.id;
    const preview = await manager.post(url('/badge-templates/preview'), { template: clean(t.body.data), templateId });
    expect(preview.status).toBe(200);
    expect(preview.headers['content-type']).toContain('application/pdf');
  });

  it('optimistic locking on template edits', async () => {
    const cur = (await manager.get(`/api/v1/badge-templates/${templateId}`)).body.data;
    expect((await manager.put(`/api/v1/badge-templates/${templateId}`, { ...clean(cur), nameTh: 'แก้ไข', version: cur.version })).status).toBe(200);
    const stale = await manager.put(`/api/v1/badge-templates/${templateId}`, { ...clean(cur), nameTh: 'ทับ', version: cur.version });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('batch prints every unprinted badge once (registrants + personnel) and renders the PDF', async () => {
    const job = await staff.post(url('/badge-print-jobs'), { templateId, mode: 'BATCH', filter: { includePersonnel: true } });
    expect(job.status).toBe(201);
    expect(job.body.data.itemCount).toBe(10); // 9 confirmed + 1 speaker
    const pdf = await staff.get(`/api/v1/badge-print-jobs/${job.body.data.id}/pdf`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    // nothing left to print
    expect((await staff.post(url('/badge-print-jobs'), { templateId, mode: 'BATCH', filter: {} })).status).toBe(422);
  });

  it('a second print is a reprint: needs badge:reprint and a reason, and is numbered', async () => {
    const instant = await staff.post(url('/badge-print-jobs'), { templateId, mode: 'INSTANT', registrationIds: [regs.student!.id] });
    expect(instant.status).toBe(409);
    expect(instant.body.error.code).toBe('ALREADY_PRINTED');
    expect((await staff.post(url('/badge-print-jobs'), { templateId, mode: 'REPRINT', registrationIds: [regs.student!.id], reason: 'ป้ายชำรุด' })).status).toBe(403);
    expect((await manager.post(url('/badge-print-jobs'), { templateId, mode: 'REPRINT', registrationIds: [regs.student!.id] })).status).toBe(422);
    const re = await manager.post(url('/badge-print-jobs'), { templateId, mode: 'REPRINT', registrationIds: [regs.student!.id], personnelIds: [speakerId], reason: 'ป้ายชำรุด' });
    expect(re.status).toBe(201);
    const hist = await staff.get(`/api/v1/registrations/${regs.student!.id}/badge-history`);
    expect(hist.body.data.map((h: { printNo: number }) => h.printNo)).toEqual([1, 2]);
    expect(hist.body.data[1].job.reason).toBe('ป้ายชำรุด');
    const cand = await staff.get(url(`/badges/candidates?search=${regs.student!.referenceNo}`));
    expect(cand.body.data[0]).toMatchObject({ printCount: 2, checkedIn: true });
    // badge prints are append-only
    await expect(prisma.badgePrint.deleteMany({ where: { registrationId: regs.student!.id } })).rejects.toThrow();
  });
});
