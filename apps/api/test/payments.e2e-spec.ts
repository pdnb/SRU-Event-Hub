import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { RegistrationsService } from '../src/registrations/registrations.service';
import { fakePng, iso, login, PASSWORD, type Session } from './helpers';

/**
 * Payment & finance flow (spec §4.7) over real HTTP + PostgreSQL + object storage.
 * Queue workers are disabled in tests (QUEUE_ENABLED=false); expiry is driven explicitly.
 */
let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;
let prisma: PrismaService;

let manager: Session;
let orgFinance: Session; // sci.finance – ORG_FINANCE_OFFICER (verifies slips, prepares batches)
let centralFinance: Session; // finance – กองคลัง (finance approval step, receives batches, receipts)
let superadmin: Session;
let eventId: string;

interface Reg {
  id: string;
  referenceNo: string;
  accessToken: string;
  status: string;
  payment: { id: string; orderNo: string; amount: string; amountText: string; status: string; promptPayPayload: string | null; dueAt: string } | null;
}
const regs: Record<string, Reg> = {};

const register = (code: string, email: string) =>
  request(http)
    .post(`/api/v1/events/${eventId}/registrations`)
    .set('Idempotency-Key', randomUUID())
    .send({ participantTypeCode: code, firstName: 'ผู้ชำระ', lastName: email.split('@')[0], email, pdpaConsent: true });

const lookup = (r: Reg) =>
  request(http).post('/api/v1/public/registrations/lookup').send({ referenceNo: r.referenceNo, token: r.accessToken });

const guestSlip = (r: Reg, file: Buffer, name = 'slip.png') =>
  request(http)
    .post('/api/v1/public/registrations/slip')
    .field('referenceNo', r.referenceNo)
    .field('token', r.accessToken)
    .field('transferredAt', new Date().toISOString())
    .attach('file', file, name);

beforeAll(async () => {
  if (!PASSWORD) throw new Error('SEED_DEMO_PASSWORD must be set for e2e tests');
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
  prisma = app.get(PrismaService);
  [manager, orgFinance, centralFinance, superadmin] = await Promise.all(
    ['sci.manager', 'sci.finance', 'finance', 'superadmin'].map((u) => login(http, u)),
  );
});

afterAll(async () => {
  await app?.close();
});

describe('paid event setup', () => {
  it('refuses a paid event without a receiving account', async () => {
    const orgs = await request(http).get('/api/v1/organizations');
    const sci = orgs.body.data.find((o: { code: string }) => o.code === 'SCI');
    const res = await manager.post('/api/v1/events', {
      titleTh: 'กิจกรรมมีค่าใช้จ่าย ไม่มีบัญชี',
      organizationId: sci.id,
      startAt: iso(20),
      endAt: iso(20.2),
      feeRates: [{ nameTh: 'ทั่วไป', amount: '800.00' }],
    });
    expect(res.status).toBe(422);
  });

  it('creates a paid event with fee rates (student rate is free)', async () => {
    const [orgs, options, types] = await Promise.all([
      request(http).get('/api/v1/organizations'),
      manager.get('/api/v1/finance/options'),
      request(http).get('/api/v1/lookups'),
    ]);
    const sci = orgs.body.data.find((o: { code: string }) => o.code === 'SCI');
    const student = types.body.data.participantTypes.find((t: { code: string }) => t.code === 'STUDENT');
    expect(options.status).toBe(200);
    const res = await manager.post('/api/v1/events', {
      titleTh: `อบรมมีค่าลงทะเบียน E2E ${randomUUID().slice(0, 6)}`,
      organizationId: sci.id,
      startAt: iso(20),
      endAt: iso(20.2),
      registrationOpenAt: iso(-1),
      registrationCloseAt: iso(19),
      capacity: 4,
      allowGuestRegistration: true,
      bankAccountId: options.body.data.bankAccounts[0].id,
      incomeCodeId: options.body.data.incomeCodes[0].id,
      paymentWindowHours: 48,
      feeRates: [
        { nameTh: 'อัตราทั่วไป', amount: '800.00' },
        { nameTh: 'นักศึกษา', amount: '0', participantTypeId: student.id },
      ],
    });
    expect(res.status).toBe(201);
    eventId = res.body.data.id;
  });

  it('paid events go through the กองคลัง finance-review step', async () => {
    expect((await manager.post(`/api/v1/events/${eventId}/submit`)).status).toBe(200);
    const dean = await login(http, 'sci.dean');
    expect((await dean.post(`/api/v1/events/${eventId}/approve`)).body.data.requestStatus).toBe('PENDING');
    // step 2 is the finance review – a regular approver cannot act on it
    const exec = await login(http, 'executive');
    expect((await exec.post(`/api/v1/events/${eventId}/approve`)).status).toBe(403);
    expect((await centralFinance.post(`/api/v1/events/${eventId}/approve`, { comment: 'อัตราและบัญชีถูกต้อง' })).status).toBe(200);
    expect((await exec.post(`/api/v1/events/${eventId}/approve`)).body.data.requestStatus).toBe('APPROVED');
    expect((await manager.post(`/api/v1/events/${eventId}/publish`)).status).toBe(200);

    const pub = await request(http).get(`/api/v1/public/events/${eventId}`);
    expect(pub.body.data.isPaid).toBe(true);
    expect(pub.body.data.feeRates).toHaveLength(2);
  });
});

describe('registration → payment order', () => {
  it('a paying registrant holds a seat as PENDING_PAYMENT with a backend-computed order + PromptPay QR', async () => {
    const res = await register('EXTERNAL', 'payer-a@example.com');
    expect(res.status).toBe(201);
    regs.a = res.body.data;
    expect(regs.a!.status).toBe('PENDING_PAYMENT');
    expect(regs.a!.payment).toMatchObject({ amount: '800.00', amountText: 'แปดร้อยบาทถ้วน', status: 'UNPAID' });
    expect(regs.a!.payment!.orderNo).toMatch(/^INV-\d{4}-\d{6}$/);
    // EMVCo tag 54 carries the amount; payload ends with a CRC16 checksum
    expect(regs.a!.payment!.promptPayPayload).toContain('5406800.00');
    expect(regs.a!.payment!.promptPayPayload).toMatch(/6304[0-9A-F]{4}$/);
  });

  it('a 0-baht rate confirms immediately without an order', async () => {
    const res = await register('STUDENT', 'student-free@example.com');
    expect(res.body.data.status).toBe('CONFIRMED');
    expect(res.body.data.payment).toBeNull();
  });

  it('registers two more payers; the fifth registrant is waitlisted', async () => {
    regs.b = (await register('EXTERNAL', 'payer-b@example.com')).body.data;
    const own = await superadmin.post(`/api/v1/events/${eventId}/registrations`, { participantTypeCode: 'STAFF', firstName: 'ผู้ดูแล', lastName: 'ระบบ', email: `sa-${randomUUID().slice(0, 6)}@example.com`, pdpaConsent: true }, { 'Idempotency-Key': randomUUID() });
    regs.su = own.body.data;
    regs.c = (await register('EXTERNAL', 'payer-c@example.com')).body.data;
    expect([regs.b!.status, regs.su!.status, regs.c!.status]).toEqual(['PENDING_PAYMENT', 'PENDING_PAYMENT', 'WAITLISTED']);
    expect(regs.c!.payment).toBeNull();
  });
});

describe('slip upload & verification', () => {
  const slipA = fakePng('a');

  it('rejects files that are not really JPG/PNG/PDF (magic number check)', async () => {
    const res = await guestSlip(regs.a!, Buffer.from('<script>alert(1)</script>'), 'slip.png');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('rejects a wrong token without revealing whether the reference exists', async () => {
    const res = await request(http).post('/api/v1/public/registrations/slip').field('referenceNo', regs.a!.referenceNo).field('token', 'x'.repeat(32)).attach('file', slipA, 'slip.png');
    expect(res.status).toBe(404);
  });

  it('accepts a slip → order PENDING_VERIFICATION; a second slip is refused while pending', async () => {
    const res = await guestSlip(regs.a!, slipA);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'SUBMITTED', amount: '800.00', hasSlip: true });
    expect(res.body.data.paymentNo).toMatch(/^PAY-\d{4}-\d{6}$/);
    const l = await lookup(regs.a!);
    expect(l.body.data.payment.status).toBe('PENDING_VERIFICATION');
    expect(l.body.data.payment.promptPayPayload).toBeNull();
    expect((await guestSlip(regs.a!, fakePng('a2'))).status).toBe(409);
  });

  it('the same slip image cannot be reused for another order', async () => {
    const res = await guestSlip(regs.b!, slipA);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_SLIP');
  });

  it('only scoped officers with payment:verify may verify; the payer never verifies own payment', async () => {
    const pending = await orgFinance.get(`/api/v1/finance/payments?status=SUBMITTED&eventId=${eventId}`);
    expect(pending.status).toBe(200);
    const pA = pending.body.data.find((p: { referenceNo: string }) => p.referenceNo === regs.a!.referenceNo);
    expect(pA).toBeTruthy();

    // กองคลัง officer has no payment:verify by default (FIN-6 pending)
    expect((await centralFinance.post(`/api/v1/finance/payments/${pA.id}/verify`)).status).toBe(403);

    // superadmin pays for own registration, then tries to verify it → separation of duties
    const own = await superadmin.upload(`/api/v1/registrations/${regs.su!.id}/slip`, fakePng('su'), 'su.png');
    expect(own.status).toBe(201);
    const sod = await superadmin.post(`/api/v1/finance/payments/${own.body.data.id}/verify`);
    expect(sod.status).toBe(403);

    const slip = await orgFinance.get(`/api/v1/finance/payments/${pA.id}/slip`);
    expect(slip.status).toBe(200);
    expect(slip.headers['content-type']).toBe('image/png');

    const ok = await orgFinance.post(`/api/v1/finance/payments/${pA.id}/verify`);
    expect(ok.status).toBe(200);
    expect((await orgFinance.post(`/api/v1/finance/payments/${pA.id}/verify`)).status).toBe(409);
    const l = await lookup(regs.a!);
    expect(l.body.data.status).toBe('CONFIRMED');
    expect(l.body.data.payment.status).toBe('PAID');
  });

  it('a rejected slip returns the order to UNPAID with at least 24 h to pay again', async () => {
    const up = await guestSlip(regs.b!, fakePng('b'));
    expect(up.status).toBe(201);
    const rej = await orgFinance.post(`/api/v1/finance/payments/${up.body.data.id}/reject`, { reason: 'ยอดเงินไม่ตรง' });
    expect(rej.status).toBe(200);
    expect(new Date(rej.body.data.newDueAt).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    const l = await lookup(regs.b!);
    expect(l.body.data.status).toBe('PENDING_PAYMENT');
    expect(l.body.data.payment).toMatchObject({ status: 'UNPAID', latestPayment: { status: 'REJECTED', rejectReason: 'ยอดเงินไม่ตรง' } });
  });
});

describe('payment expiry', () => {
  it('an overdue unpaid order expires, releases the seat and promotes the waitlist into a new order', async () => {
    await prisma.$executeRaw`UPDATE payment_orders SET due_at = now() - interval '1 minute' WHERE id = ${regs.b!.payment!.id}::uuid`;
    const n = await app.get(RegistrationsService).expireOverdue();
    expect(n).toBeGreaterThanOrEqual(1);

    const b = await lookup(regs.b!);
    expect(b.body.data.status).toBe('EXPIRED');
    expect(b.body.data.payment.status).toBe('EXPIRED');

    const c = await lookup(regs.c!);
    expect(c.body.data.status).toBe('PENDING_PAYMENT');
    expect(c.body.data.payment).toMatchObject({ status: 'UNPAID', amount: '800.00' });
    regs.c!.payment = c.body.data.payment;
    const ev = await manager.get(`/api/v1/events/${eventId}`);
    expect(ev.body.data.seatsTaken).toBe(4);
  });

  it('a slip submitted before the deadline is not expired while it waits for review', async () => {
    const up = await guestSlip(regs.c!, fakePng('c'));
    expect(up.status).toBe(201);
    await prisma.$executeRaw`UPDATE payment_orders SET due_at = now() - interval '1 minute' WHERE id = ${regs.c!.payment!.id}::uuid`;
    await app.get(RegistrationsService).expireOverdue();
    expect((await lookup(regs.c!)).body.data.status).toBe('PENDING_PAYMENT');
  });
});

describe('money integrity (database level)', () => {
  it('the ledger is append-only and money columns are immutable', async () => {
    await expect(prisma.$executeRaw`UPDATE payment_ledger_entries SET amount = 1 WHERE order_id = ${regs.a!.payment!.id}::uuid`).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRaw`DELETE FROM payment_ledger_entries WHERE order_id = ${regs.a!.payment!.id}::uuid`).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRaw`UPDATE payment_orders SET amount = 1 WHERE id = ${regs.a!.payment!.id}::uuid`).rejects.toThrow(/immutable/);
    const sum = await prisma.$queryRaw<{ s: string }[]>`SELECT SUM(amount)::text AS s FROM payment_ledger_entries WHERE order_id = ${regs.a!.payment!.id}::uuid`;
    expect(sum[0]!.s).toBe('0.00'); // CHARGE +800 and PAYMENT −800
  });
});

describe('finance batch → กองคลัง', () => {
  let batchId: string;

  it('lists eligible verified payments and creates a batch with frozen totals', async () => {
    const el = await orgFinance.get(`/api/v1/finance/batches/eligible?eventId=${eventId}`);
    expect(el.status).toBe(200);
    expect(el.body.data).toMatchObject({ count: 1, totalAmount: '800.00' });
    const res = await orgFinance.post('/api/v1/finance/batches', { eventId, note: 'นำส่งรอบที่ 1' });
    expect(res.status).toBe(201);
    expect(res.body.data.batchNo).toMatch(/^FB-\d{4}-\d{6}$/);
    batchId = res.body.data.id;
    // nothing left to batch
    expect((await orgFinance.post('/api/v1/finance/batches', { eventId })).status).toBe(409);
  });

  it('submit → receive (by a different person) → record receipt numbers → RECEIPTS_ISSUED', async () => {
    expect((await centralFinance.post(`/api/v1/finance/batches/${batchId}/receive`)).status).toBe(409); // still DRAFT
    expect((await orgFinance.post(`/api/v1/finance/batches/${batchId}/submit`)).status).toBe(200);
    expect((await orgFinance.post(`/api/v1/finance/batches/${batchId}/receive`)).status).toBe(403); // no permission / SoD
    expect((await centralFinance.post(`/api/v1/finance/batches/${batchId}/receive`)).status).toBe(200);

    const detail = await centralFinance.get(`/api/v1/finance/batches/${batchId}`);
    expect(detail.body.data).toMatchObject({ status: 'RECEIVED', totalAmount: '800.00', totalAmountText: 'แปดร้อยบาทถ้วน', itemCount: 1 });
    const paymentId = detail.body.data.items[0].paymentId;
    const receiptNo = `E2E${Date.now()}`;
    const rec = await centralFinance.post(`/api/v1/finance/batches/${batchId}/receipts`, { receipts: [{ paymentId, bookNo: 'E2E', receiptNo, issuedAt: new Date().toISOString() }] });
    expect(rec.status).toBe(200);
    expect(rec.body.data.complete).toBe(true);
    const again = await centralFinance.post(`/api/v1/finance/batches/${batchId}/receipts`, { receipts: [{ paymentId, bookNo: 'E2E', receiptNo, issuedAt: new Date().toISOString() }] });
    expect(again.status).toBe(409);
    expect((await centralFinance.get(`/api/v1/finance/batches/${batchId}`)).body.data.status).toBe('RECEIPTS_ISSUED');
  });

  it('exports the remittance report as xlsx', async () => {
    const res = await orgFinance.get(`/api/v1/finance/batches/${batchId}/export`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
  });
});

describe('event cancellation closes the money side', () => {
  it('voids pending slips, cancels unpaid orders and flags paid orders for refund', async () => {
    expect((await manager.post(`/api/v1/events/${eventId}/cancel`, { reason: 'ข้อมูลทดสอบอัตโนมัติ (e2e)' })).status).toBe(200);
    const [a, c] = await Promise.all([lookup(regs.a!), lookup(regs.c!)]);
    expect(a.body.data.payment.status).toBe('REFUND_PENDING');
    expect(c.body.data.payment.status).toBe('CANCELLED');
    expect(c.body.data.payment.latestPayment.status).toBe('VOIDED');
  });
});
