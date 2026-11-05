import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { iso, login, PASSWORD, type Session } from './helpers';

/** P2b: on-site cashier sessions, refunds, receipt voiding, audit log and settings APIs. */
let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;
let prisma: PrismaService;
let manager: Session, cashier: Session, orgFinance: Session, centralFinance: Session, superadmin: Session;
let eventId: string;
const orders: Record<string, { orderId: string; referenceNo: string }> = {};

const register = (email: string) =>
  request(http)
    .post(`/api/v1/events/${eventId}/registrations`)
    .set('Idempotency-Key', randomUUID())
    .send({ participantTypeCode: 'EXTERNAL', firstName: 'หน้างาน', lastName: email.split('@')[0], email, pdpaConsent: true });

beforeAll(async () => {
  if (!PASSWORD) throw new Error('SEED_DEMO_PASSWORD must be set for e2e tests');
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
  prisma = app.get(PrismaService);
  [manager, cashier, orgFinance, centralFinance, superadmin] = await Promise.all(
    ['sci.manager', 'cashier', 'sci.finance', 'finance', 'superadmin'].map((u) => login(http, u)),
  );

  // A published paid event (800 baht) with three unpaid registrations.
  const [orgs, options] = await Promise.all([request(http).get('/api/v1/organizations'), manager.get('/api/v1/finance/options')]);
  const sci = orgs.body.data.find((o: { code: string }) => o.code === 'SCI');
  const ev = await manager.post('/api/v1/events', {
    titleTh: `งานรับเงินหน้างาน E2E ${randomUUID().slice(0, 6)}`,
    organizationId: sci.id,
    startAt: iso(5),
    endAt: iso(5.2),
    registrationOpenAt: iso(-1),
    registrationCloseAt: iso(4),
    allowGuestRegistration: true,
    bankAccountId: options.body.data.bankAccounts[0].id,
    feeRates: [{ nameTh: 'อัตราทั่วไป', amount: '800.00' }],
  });
  eventId = ev.body.data.id;
  await manager.post(`/api/v1/events/${eventId}/submit`);
  await (await login(http, 'sci.dean')).post(`/api/v1/events/${eventId}/approve`);
  await centralFinance.post(`/api/v1/events/${eventId}/approve`);
  await (await login(http, 'executive')).post(`/api/v1/events/${eventId}/approve`);
  await manager.post(`/api/v1/events/${eventId}/publish`);
  for (const k of ['a', 'b', 'c']) {
    const r = await register(`cash-${k}@example.com`);
    orders[k] = { orderId: r.body.data.payment.id, referenceNo: r.body.data.referenceNo };
  }
});

afterAll(async () => {
  if (eventId) await manager.post(`/api/v1/events/${eventId}/cancel`, { reason: 'ข้อมูลทดสอบอัตโนมัติ (e2e)' });
  await app?.close();
});

const regStatus = async (referenceNo: string) =>
  (await prisma.registration.findUniqueOrThrow({ where: { referenceNo } })).status;

describe('on-site cashier session', () => {
  let sessionId: string;
  let paymentA: string;
  let paymentB: string;

  it('opens one session per cashier per event', async () => {
    const res = await cashier.post('/api/v1/finance/cashier-sessions', { eventId, openingFloat: '500.00' });
    expect(res.status).toBe(201);
    expect(res.body.data.sessionNo).toMatch(/^CS-\d{4}-\d{6}$/);
    sessionId = res.body.data.id;
    expect((await cashier.post('/api/v1/finance/cashier-sessions', { eventId })).status).toBe(409);
  });

  it('lists payable orders and collects cash exactly once per Idempotency-Key', async () => {
    const pay = await cashier.get(`/api/v1/finance/cashier-sessions/${sessionId}/payables?search=${orders.a!.referenceNo}`);
    expect(pay.body.data).toHaveLength(1);
    expect(pay.body.data[0]).toMatchObject({ amount: '800.00', orderId: orders.a!.orderId });

    const key = randomUUID();
    const first = await cashier.post(`/api/v1/finance/cashier-sessions/${sessionId}/collect`, { orderId: orders.a!.orderId }, { 'Idempotency-Key': key });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ channel: 'ONSITE', status: 'VERIFIED', amount: '800.00', amountText: 'แปดร้อยบาทถ้วน' });
    const retry = await cashier.post(`/api/v1/finance/cashier-sessions/${sessionId}/collect`, { orderId: orders.a!.orderId }, { 'Idempotency-Key': key });
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.data.id).toBe(first.body.data.id);
    const again = await cashier.post(`/api/v1/finance/cashier-sessions/${sessionId}/collect`, { orderId: orders.a!.orderId }, { 'Idempotency-Key': randomUUID() });
    expect(again.status).toBe(409);
    paymentA = first.body.data.id;
    expect(await regStatus(orders.a!.referenceNo)).toBe('CONFIRMED');

    paymentB = (await cashier.post(`/api/v1/finance/cashier-sessions/${sessionId}/collect`, { orderId: orders.b!.orderId }, { 'Idempotency-Key': randomUUID() })).body.data.id;
  });

  it('voiding cash needs another person with cashier:void and reverses the booking', async () => {
    expect((await cashier.post(`/api/v1/finance/cashier-sessions/payments/${paymentB}/void`, { reason: 'รับผิดคน' })).status).toBe(403);
    const v = await orgFinance.post(`/api/v1/finance/cashier-sessions/payments/${paymentB}/void`, { reason: 'รับผิดคน' });
    expect(v.status).toBe(200);
    expect(await regStatus(orders.b!.referenceNo)).toBe('PENDING_PAYMENT');
    const order = await prisma.paymentOrder.findUniqueOrThrow({ where: { id: orders.b!.orderId } });
    expect(order.status).toBe('UNPAID');
    const sum = await prisma.$queryRaw<{ s: string }[]>`SELECT SUM(amount)::text AS s FROM payment_ledger_entries WHERE order_id = ${orders.b!.orderId}::uuid`;
    expect(sum[0]!.s).toBe('800.00'); // CHARGE + PAYMENT − … + REVERSAL → owed again
  });

  it('closing requires a note when the count differs, and freezes the totals', async () => {
    const bad = await cashier.post(`/api/v1/finance/cashier-sessions/${sessionId}/close`, { countedAmount: '700.00' });
    expect(bad.status).toBe(422);
    const ok = await cashier.post(`/api/v1/finance/cashier-sessions/${sessionId}/close`, { countedAmount: '700.00', note: 'เงินขาด 100 บาท แจ้งหัวหน้าแล้ว' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ expectedAmount: '800.00', countedAmount: '700.00', difference: '-100.00' });
    await expect(prisma.$executeRaw`UPDATE cashier_sessions SET counted_amount = 800 WHERE id = ${sessionId}::uuid`).rejects.toThrow(/immutable/);
    // closed session: no more collecting or voiding
    expect((await cashier.post(`/api/v1/finance/cashier-sessions/${sessionId}/collect`, { orderId: orders.c!.orderId }, { 'Idempotency-Key': randomUUID() })).status).toBe(409);
  });

  it('cash is batchable only after the remitted session is confirmed by someone else', async () => {
    const before = await orgFinance.get(`/api/v1/finance/batches/eligible?eventId=${eventId}`);
    expect(before.body.data.count).toBe(0);
    expect((await cashier.post(`/api/v1/finance/cashier-sessions/${sessionId}/remit`, { remittanceNo: 'RM-001' })).status).toBe(200);
    expect((await cashier.post(`/api/v1/finance/cashier-sessions/${sessionId}/confirm`)).status).toBe(403);
    expect((await orgFinance.post(`/api/v1/finance/cashier-sessions/${sessionId}/confirm`)).status).toBe(200);
    const after = await orgFinance.get(`/api/v1/finance/batches/eligible?eventId=${eventId}`);
    expect(after.body.data).toMatchObject({ count: 1, totalAmount: '800.00' });
    expect(after.body.data.payments[0].id).toBe(paymentA);
  });
});

describe('receipt void', () => {
  it('voiding a receipt number reopens the batch for a replacement number', async () => {
    const b = await orgFinance.post('/api/v1/finance/batches', { eventId });
    const batchId = b.body.data.id;
    await orgFinance.post(`/api/v1/finance/batches/${batchId}/submit`);
    await centralFinance.post(`/api/v1/finance/batches/${batchId}/receive`);
    const detail = await centralFinance.get(`/api/v1/finance/batches/${batchId}`);
    const paymentId = detail.body.data.items[0].paymentId;
    const no = `V${Date.now()}`;
    await centralFinance.post(`/api/v1/finance/batches/${batchId}/receipts`, { receipts: [{ paymentId, bookNo: 'E2E', receiptNo: no, issuedAt: new Date().toISOString() }] });
    const issued = await centralFinance.get(`/api/v1/finance/batches/${batchId}`);
    expect(issued.body.data.status).toBe('RECEIPTS_ISSUED');

    const v = await centralFinance.post(`/api/v1/finance/batches/receipts/${issued.body.data.items[0].receipt.id}/void`, { reason: 'พิมพ์เลขผิด' });
    expect(v.status).toBe(200);
    expect((await centralFinance.get(`/api/v1/finance/batches/${batchId}`)).body.data.status).toBe('RECEIVED');
    const re = await centralFinance.post(`/api/v1/finance/batches/${batchId}/receipts`, { receipts: [{ paymentId, bookNo: 'E2E', receiptNo: `${no}A`, issuedAt: new Date().toISOString() }] });
    expect(re.body.data.complete).toBe(true);
  });
});

describe('refunds', () => {
  let r1: string;
  let r2: string;

  it('cannot refund more than was received; the account number is stored encrypted and masked', async () => {
    const list = await orgFinance.get(`/api/v1/finance/refunds/refundable?eventId=${eventId}`);
    expect(list.body.data).toEqual([expect.objectContaining({ orderId: orders.a!.orderId, paid: '800.00', refundable: '800.00' })]);
    const body = { orderId: orders.a!.orderId, reason: 'ขอคืนบางส่วน', payeeName: 'หน้างาน cash-a', bankName: 'กรุงไทย', accountNo: '123-4-56789-0' };
    expect((await orgFinance.post('/api/v1/finance/refunds', { ...body, amount: '900.00' })).status).toBe(422);
    const ok = await orgFinance.post('/api/v1/finance/refunds', { ...body, amount: '300.00' });
    expect(ok.status).toBe(201);
    r1 = ok.body.data.id;
    const row = await prisma.refund.findUniqueOrThrow({ where: { id: r1 } });
    expect(row.accountNoEnc).not.toContain('56789');
    expect(row.accountNoMasked).toBe('••••••7890');
    expect((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: orders.a!.orderId } })).status).toBe('REFUND_PENDING');
  });

  it('the requester can never approve or pay their own refund', async () => {
    const own = await centralFinance.post('/api/v1/finance/refunds', { orderId: orders.a!.orderId, amount: '200.00', reason: 'ทดสอบ SoD', payeeName: 'ผู้รับเงิน กองคลัง', bankName: 'กรุงไทย', accountNo: '1112223334' });
    r2 = own.body.data.id;
    expect((await centralFinance.post(`/api/v1/finance/refunds/${r2}/approve`)).status).toBe(403);
    expect((await orgFinance.post(`/api/v1/finance/refunds/${r1}/approve`)).status).toBe(403); // no refund:approve
  });

  it('approve → pay books a REFUND ledger entry and updates the order status', async () => {
    expect((await centralFinance.post(`/api/v1/finance/refunds/${r1}/pay`, { paidRef: 'TRX-1' })).status).toBe(409); // not approved yet
    expect((await centralFinance.post(`/api/v1/finance/refunds/${r1}/approve`)).status).toBe(200);
    const reveal = await centralFinance.post(`/api/v1/finance/refunds/${r1}/reveal-account`);
    expect(reveal.body.data.accountNo).toBe('123-4-56789-0');
    expect((await centralFinance.post(`/api/v1/finance/refunds/${r1}/pay`, { paidRef: 'TRX-1' })).status).toBe(200);
    // r2 still in flight → REFUND_PENDING; once rejected → PARTIALLY_REFUNDED
    expect((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: orders.a!.orderId } })).status).toBe('REFUND_PENDING');
    expect((await superadmin.post(`/api/v1/finance/refunds/${r2}/reject`, { reason: 'ทดสอบ' })).status).toBe(200);
    expect((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: orders.a!.orderId } })).status).toBe('PARTIALLY_REFUNDED');
    const refunds = await prisma.paymentLedgerEntry.findMany({ where: { orderId: orders.a!.orderId, entryType: 'REFUND' } });
    expect(refunds.map((r) => r.amount.toFixed(2))).toEqual(['300.00']);
  });
});

describe('audit log & settings', () => {
  it('audit_log:view lists actions with actor names; others are refused', async () => {
    const res = await superadmin.get('/api/v1/audit-logs?action=refund.&perPage=50');
    expect(res.status).toBe(200);
    const actions = res.body.data.map((r: { action: string }) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['refund.request', 'refund.reveal_account', 'refund.pay']));
    expect(JSON.stringify(res.body.data)).not.toContain('56789'); // account number never logged
    expect((await cashier.get('/api/v1/audit-logs')).status).toBe(403);
  });

  it('settings keep their JSON type', async () => {
    const list = await superadmin.get('/api/v1/settings');
    const lead = list.body.data.find((s: { key: string }) => s.key === 'finance.submissionLeadDays');
    expect((await superadmin.patch('/api/v1/settings/finance.submissionLeadDays', { value: 'สิบ' })).status).toBe(422);
    expect((await superadmin.patch('/api/v1/settings/finance.submissionLeadDays', { value: 10 })).body.data.value).toBe(10);
    await superadmin.patch('/api/v1/settings/finance.submissionLeadDays', { value: lead.value });
    expect((await superadmin.patch('/api/v1/settings/no.such.key', { value: 1 })).status).toBe(404);
  });
});
