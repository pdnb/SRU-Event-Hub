import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { RegistrationsService } from '../src/registrations/registrations.service';
import { fakePng, iso, login, PASSWORD, type Session } from './helpers';

/**
 * Group registration (spec §4.6.1, P3) over real HTTP + PostgreSQL:
 * participant org → draft group → members (manual / invitation link / Excel) → atomic submit with a
 * combined order → member changes (re-issued order) → payment → substitution → expiry → cancel,
 * plus a concurrent "last seats" race between two groups.
 */
let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;
let prisma: PrismaService;

let manager: Session;
let orgFinance: Session;
let coordinator: Session;
let eventId: string;
let orgId: string;
let g1: string; // main group
const tag = randomUUID().slice(0, 6);
const mail = (n: string) => `grp-${tag}-${n}@example.com`;

const member = (n: string, type = 'EXTERNAL') => ({ participantTypeCode: type, firstName: 'สมาชิก', lastName: n, email: mail(n) });
const seats = async () => (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).seatsTaken;
const detail = async (id: string) => (await coordinator.get(`/api/v1/groups/${id}`)).body.data;

async function newGroup(name: string, members: string[]) {
  const res = await coordinator.post(`/api/v1/events/${eventId}/groups`, { participantOrganizationId: orgId, name }, { 'Idempotency-Key': randomUUID() });
  expect(res.status).toBe(201);
  for (const m of members) expect((await coordinator.post(`/api/v1/groups/${res.body.data.id}/members`, member(m))).status).toBe(201);
  return res.body.data.id as string;
}

beforeAll(async () => {
  if (!PASSWORD) throw new Error('SEED_DEMO_PASSWORD must be set for e2e tests');
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
  prisma = app.get(PrismaService);
  [manager, orgFinance, coordinator] = await Promise.all(['sci.manager', 'sci.finance', 'coordinator'].map((u) => login(http, u)));
});

afterAll(async () => {
  await app?.close();
});

describe('setup', () => {
  it('creates and publishes a paid event (capacity 8) and enables groups of 2–5', async () => {
    const [orgs, options, types] = await Promise.all([
      request(http).get('/api/v1/organizations'),
      manager.get('/api/v1/finance/options'),
      request(http).get('/api/v1/lookups'),
    ]);
    const sci = orgs.body.data.find((o: { code: string }) => o.code === 'SCI');
    const student = types.body.data.participantTypes.find((t: { code: string }) => t.code === 'STUDENT');
    const res = await manager.post('/api/v1/events', {
      titleTh: `อบรมรับกลุ่ม E2E ${tag}`,
      organizationId: sci.id,
      startAt: iso(20),
      endAt: iso(20.2),
      registrationOpenAt: iso(-1),
      registrationCloseAt: iso(19),
      capacity: 8,
      allowGuestRegistration: true,
      bankAccountId: options.body.data.bankAccounts[0].id,
      incomeCodeId: options.body.data.incomeCodes[0].id,
      paymentWindowHours: 48,
      feeRates: [
        { nameTh: 'อัตราทั่วไป', amount: '500.00' },
        { nameTh: 'นักเรียน/นักศึกษา', amount: '200.00', participantTypeId: student.id },
      ],
    });
    expect(res.status).toBe(201);
    eventId = res.body.data.id;
    expect((await manager.post(`/api/v1/events/${eventId}/submit`)).status).toBe(200);
    for (const u of ['sci.dean', 'finance', 'executive']) {
      expect((await (await login(http, u)).post(`/api/v1/events/${eventId}/approve`, { comment: 'ok' })).status).toBe(200);
    }
    expect((await manager.post(`/api/v1/events/${eventId}/publish`)).status).toBe(200);

    // groups are off until the organizer enables them
    expect((await request(http).get(`/api/v1/public/events/${eventId}/group-settings`)).body.data.isEnabled).toBe(false);
    const bad = await manager.put(`/api/v1/events/${eventId}/group-settings`, { isEnabled: true, minMembers: 5, maxMembers: 2, allowImport: true, allowInviteLinks: true });
    expect(bad.status).toBe(422);
    const s = await manager.put(`/api/v1/events/${eventId}/group-settings`, { isEnabled: true, minMembers: 2, maxMembers: 5, allowImport: true, allowInviteLinks: true });
    expect(s.status).toBe(200);
    expect((await coordinator.put(`/api/v1/events/${eventId}/group-settings`, { isEnabled: false, minMembers: 2, maxMembers: 5, allowImport: true, allowInviteLinks: true })).status).toBe(403);
  });

  it('a coordinator creates a participant organization (tax id checksum enforced)', async () => {
    const bad = await coordinator.post('/api/v1/participant-orgs', { nameTh: 'โรงเรียนผิด', orgType: 'SCHOOL', taxId: '1234567890123' });
    expect(bad.status).toBe(422);
    const res = await coordinator.post('/api/v1/participant-orgs', { nameTh: `โรงเรียนทดสอบกลุ่ม ${tag}`, orgType: 'SCHOOL', province: 'สุราษฎร์ธานี', position: 'ครูผู้ประสานงาน' });
    expect(res.status).toBe(201);
    orgId = res.body.data.id;
    expect(res.body.data.coordinators[0].isPrimary).toBe(true);
    expect((await coordinator.get('/api/v1/me/participant-orgs')).body.data.some((o: { id: string }) => o.id === orgId)).toBe(true);
  });
});

describe('draft group: members from three sources', () => {
  it('only a coordinator of the organization can open a group', async () => {
    expect((await manager.post(`/api/v1/events/${eventId}/groups`, { participantOrganizationId: orgId, name: 'ไม่ใช่ผู้ประสาน' }, { 'Idempotency-Key': randomUUID() })).status).toBe(403);
    g1 = await newGroup('ทีมนักเรียน ม.6', ['a', 'b']);
    const d = await detail(g1);
    expect(d).toMatchObject({ status: 'DRAFT', memberCount: 2, canChangeMembers: true });
    expect(d.groupNo).toMatch(/^GRP-\d{4}-\d{6}$/);
    expect(d.members[0].referenceNo).toBeNull(); // no REG number until submitted
    expect(await seats()).toBe(0); // drafts hold no seat
  });

  it('rejects a duplicate e-mail within the group', async () => {
    const res = await coordinator.post(`/api/v1/groups/${g1}/members`, member('a'));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_MEMBER');
  });

  it('drafts are invisible to the organizer registration list', async () => {
    const list = await manager.get(`/api/v1/events/${eventId}/registrations`);
    expect(list.body.data.some((r: { email: string }) => r.email === mail('a'))).toBe(false);
  });

  it('an open invitation link lets a member add themselves (own PDPA consent), limited uses', async () => {
    const inv = await coordinator.post(`/api/v1/groups/${g1}/invitations`, { maxUses: 1 });
    expect(inv.status).toBe(201);
    const view = await request(http).post('/api/v1/public/group-invitations/view').send({ token: inv.body.data.token });
    expect(view.status).toBe(200);
    expect(view.body.data.member).toBeNull();
    expect(JSON.stringify(view.body.data)).not.toContain(mail('a')); // never leaks other members

    const noConsent = await request(http).post('/api/v1/public/group-invitations/accept').send({ ...member('c', 'STUDENT'), pdpaConsent: false, token: inv.body.data.token });
    expect(noConsent.status).toBe(422);
    const ok = await request(http).post('/api/v1/public/group-invitations/accept').send({ ...member('c', 'STUDENT'), pdpaConsent: true, token: inv.body.data.token });
    expect(ok.status).toBe(200);
    const again = await request(http).post('/api/v1/public/group-invitations/accept').send({ ...member('c2'), pdpaConsent: true, token: inv.body.data.token });
    expect(again.status).toBe(404);
    expect(again.body.error.code).toBe('INVITATION_INVALID');
    const d = await detail(g1);
    expect(d.members.find((m: { email: string }) => m.email === mail('c')).selfConsented).toBe(true);
  });

  it('imports members from Excel: validate → preview (row errors) → commit valid rows only', async () => {
    const tpl = await coordinator.get(`/api/v1/groups/${g1}/import-template`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(tpl.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl.body as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.getRow(1).getCell(2).value).toBe('ชื่อ *');
    ws.addRow(['นาย', 'สมาชิก', 'd', mail('d'), '812345678', 'บุคคลภายนอก']);
    ws.addRow(['', 'ไม่มีอีเมล', 'e', '', '', 'EXTERNAL']);
    ws.addRow(['', 'ซ้ำ', 'a', mail('a'), '', 'EXTERNAL']);
    const file = Buffer.from(await wb.xlsx.writeBuffer());

    const up = await coordinator.upload(`/api/v1/groups/${g1}/imports`, file, 'members.xlsx');
    expect(up.status).toBe(201);
    expect(up.body.data).toMatchObject({ totalRows: 3, validRows: 1, invalidRows: 2, status: 'VALIDATED' });
    const rows = up.body.data.rows;
    expect(rows[1].errors['อีเมล']).toBe('จำเป็นต้องกรอก');
    expect(rows[2].errors['อีเมล']).toBe('อยู่ในกลุ่มนี้แล้ว');

    const commit = await coordinator.post(`/api/v1/groups/${g1}/imports/${up.body.data.id}/commit`);
    expect(commit.status).toBe(200);
    const d = commit.body.data.members.find((m: { email: string }) => m.email === mail('d'));
    expect(d.phone).toBe('0812345678'); // leading 0 restored
    expect(commit.body.data.memberCount).toBe(4);
    expect((await coordinator.post(`/api/v1/groups/${g1}/imports/${up.body.data.id}/commit`)).status).toBe(409);
  });

  it('enforces the maximum group size', async () => {
    expect((await coordinator.post(`/api/v1/groups/${g1}/members`, member('e'))).status).toBe(201);
    const res = await coordinator.post(`/api/v1/groups/${g1}/members`, member('f'));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GROUP_FULL');
  });
});

describe('submit: atomic seat reservation + combined order', () => {
  it('requires the coordinator PDPA attestation', async () => {
    expect((await coordinator.post(`/api/v1/groups/${g1}/submit`, { pdpaAttestation: false }, { 'Idempotency-Key': randomUUID() })).status).toBe(422);
  });

  it('reserves all 5 seats at once and issues one order = sum of member fees', async () => {
    const res = await coordinator.post(`/api/v1/groups/${g1}/submit`, { pdpaAttestation: true }, { 'Idempotency-Key': randomUUID() });
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.status).toBe('PENDING_PAYMENT');
    expect(await seats()).toBe(5);
    // 4 × 500 (general) + 1 × 200 (student)
    expect(d.payment).toMatchObject({ amount: '2200.00', status: 'UNPAID' });
    expect(d.members.every((m: { referenceNo: string; status: string }) => /^REG-\d{4}-\d{6}$/.test(m.referenceNo) && m.status === 'PENDING_PAYMENT')).toBe(true);
    expect(d.members.find((m: { email: string }) => m.email === mail('c')).feeAmount).toBe('200.00');
    const consent = await prisma.groupConsent.findFirst({ where: { groupId: g1, consentType: 'COORDINATOR_ATTESTATION' } });
    expect(consent?.memberCount).toBe(5);
  });

  it('a group larger than the remaining seats is refused entirely (no partial booking)', async () => {
    const g = await newGroup('กลุ่มใหญ่เกินที่นั่ง', ['x1', 'x2', 'x3', 'x4']);
    const res = await coordinator.post(`/api/v1/groups/${g}/submit`, { pdpaAttestation: true }, { 'Idempotency-Key': randomUUID() });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'GROUP_SEATS_UNAVAILABLE', details: { available: 3, requested: 4 } });
    expect(await seats()).toBe(5);
    expect((await detail(g)).status).toBe('DRAFT');
    await coordinator.post(`/api/v1/groups/${g}/cancel`, {});
  });

  it('individual cancellation of a group member is refused (managed through the group)', async () => {
    const reg = await prisma.registration.findFirstOrThrow({ where: { groupId: g1 } });
    const res = await manager.post(`/api/v1/registrations/${reg.id}/cancel`, { reason: 'x' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GROUP_MEMBER');
  });

  it('organizer sees the submitted group and its members with the group number', async () => {
    const groups = await manager.get(`/api/v1/events/${eventId}/groups`);
    expect(groups.body.data.find((g: { id: string }) => g.id === g1)).toMatchObject({ memberCount: 5, status: 'PENDING_PAYMENT' });
    const regs = await manager.get(`/api/v1/events/${eventId}/registrations?groupId=${g1}`);
    expect(regs.body.data).toHaveLength(5);
    expect(regs.body.data[0].groupNo).toMatch(/^GRP-/);
  });
});

describe('changes after submission', () => {
  it('removing a member (unpaid) releases the seat and re-issues the order with the same deadline', async () => {
    const before = await detail(g1);
    const e = before.members.find((m: { email: string }) => m.email === mail('e'));
    expect((await coordinator.post(`/api/v1/groups/${g1}/members/${e.id}/remove`, {})).status).toBe(422); // reason required
    const res = await coordinator.post(`/api/v1/groups/${g1}/members/${e.id}/remove`, { reason: 'ติดภารกิจ' });
    expect(res.status).toBe(200);
    expect(res.body.data.memberCount).toBe(4);
    expect(res.body.data.payment.amount).toBe('1700.00');
    expect(res.body.data.payment.orderNo).not.toBe(before.payment.orderNo);
    expect(res.body.data.payment.dueAt).toBe(before.payment.dueAt);
    expect(await seats()).toBe(4);
    const old = await prisma.paymentOrder.findUniqueOrThrow({ where: { orderNo: before.payment.orderNo } });
    expect(old.status).toBe('CANCELLED');
  });

  it('pays the combined order: coordinator uploads a slip, finance verifies → whole group confirmed', async () => {
    const up = await coordinator.upload(`/api/v1/groups/${g1}/slip`, fakePng(`grp-${tag}`), 'slip.png', { transferredAt: new Date().toISOString() });
    expect(up.status).toBe(201);
    expect(up.body.data.amount).toBe('1700.00');
    // separation of duties: the coordinator cannot verify their own payment (also lacks permission)
    const v = await orgFinance.post(`/api/v1/finance/payments/${up.body.data.id}/verify`);
    expect(v.status).toBe(200);
    const d = await detail(g1);
    expect(d.status).toBe('CONFIRMED');
    expect(d.payment.status).toBe('PAID');
    expect(d.members.every((m: { status: string }) => m.status === 'CONFIRMED')).toBe(true);
    const fin = await orgFinance.get(`/api/v1/finance/payments?search=${d.groupNo}`);
    expect(fin.body.data[0].referenceNo).toBe(d.groupNo);
  });

  it('after payment members cannot be added, but can be substituted (logged)', async () => {
    const add = await coordinator.post(`/api/v1/groups/${g1}/members`, member('late'));
    expect(add.status).toBe(409);
    const d = await detail(g1);
    const b = d.members.find((m: { email: string }) => m.email === mail('b'));
    const sub = await coordinator.put(`/api/v1/groups/${g1}/members/${b.id}`, { ...member('b-new'), reason: 'เปลี่ยนตัวผู้เข้าร่วม' });
    expect(sub.status).toBe(200);
    expect(sub.body.data.members.find((m: { id: string }) => m.id === b.id)).toMatchObject({ email: mail('b-new'), status: 'CONFIRMED', referenceNo: b.referenceNo });
    const typeChange = await coordinator.put(`/api/v1/groups/${g1}/members/${b.id}`, { ...member('b-new', 'STUDENT'), reason: 'x' });
    expect(typeChange.status).toBe(409);
    const logs = await coordinator.get(`/api/v1/groups/${g1}/change-logs`);
    expect(logs.body.data.map((l: { action: string }) => l.action)).toEqual(expect.arrayContaining(['member.substitute', 'order.reissue', 'group.submit', 'member.remove']));
  });

  it('the change log is append-only at the database level', async () => {
    await expect(prisma.groupChangeLog.deleteMany({ where: { groupId: g1 } })).rejects.toThrow();
  });
});

describe('expiry and concurrency', () => {
  it('an unpaid group expires as a whole and its seats are released', async () => {
    const g = await newGroup('กลุ่มไม่ชำระ', ['y1', 'y2']);
    expect((await coordinator.post(`/api/v1/groups/${g}/submit`, { pdpaAttestation: true }, { 'Idempotency-Key': randomUUID() })).status).toBe(200);
    expect(await seats()).toBe(6);
    const order = await prisma.paymentOrder.findFirstOrThrow({ where: { groupId: g, status: 'UNPAID' } });
    await prisma.$executeRaw`UPDATE payment_orders SET due_at = now() - interval '1 minute' WHERE id = ${order.id}::uuid`;
    expect(await app.get(RegistrationsService).expireOrder(order.id)).toBe(true);
    const d = await detail(g);
    expect(d.status).toBe('EXPIRED');
    expect(await seats()).toBe(4);
    expect(await prisma.registration.count({ where: { groupId: g, status: 'EXPIRED' } })).toBe(2);
  });

  it('two groups racing for the last seats: exactly one wins', async () => {
    const [ga, gb] = [await newGroup('แข่ง A', ['ra1', 'ra2', 'ra3']), await newGroup('แข่ง B', ['rb1', 'rb2', 'rb3'])];
    // 4 seats left: 3 + 3 cannot both fit
    const [ra, rb] = await Promise.all(
      [ga, gb].map((g) => coordinator.post(`/api/v1/groups/${g}/submit`, { pdpaAttestation: true }, { 'Idempotency-Key': randomUUID() })),
    );
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    expect(await seats()).toBe(7);
  });

  it('cancelling the paid group sends the order to refund and frees its seats', async () => {
    const res = await coordinator.post(`/api/v1/groups/${g1}/cancel`, { reason: 'โรงเรียนงดเดินทาง' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
    expect(res.body.data.payment.status).toBe('REFUND_PENDING');
    expect(await seats()).toBe(3);
  });
});

describe('event cancellation', () => {
  it('cancels every open group with the event and frees all seats', async () => {
    const res = await manager.post(`/api/v1/events/${eventId}/cancel`, { reason: 'งดจัดกิจกรรม' });
    expect(res.status).toBe(200);
    expect(await prisma.registrationGroup.count({ where: { eventId, status: { in: ['DRAFT', 'PENDING_PAYMENT', 'CONFIRMED'] } } })).toBe(0);
    expect(await prisma.registration.count({ where: { eventId, status: { in: ['DRAFT', 'PENDING_PAYMENT', 'CONFIRMED'] } } })).toBe(0);
    expect(await seats()).toBe(0);
  });
});
