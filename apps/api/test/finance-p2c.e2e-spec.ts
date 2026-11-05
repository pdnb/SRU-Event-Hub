import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { fakePng, iso, login, PASSWORD, type Session } from './helpers';

/**
 * P2c: remittance PDF/Excel templates (FIN-1), bank-statement reconciliation, fee change after
 * approval (FEE_CHANGE), juristic-person receipt data (FIN-9) and offline cash capture (FIN-12).
 */
let app: INestApplication;
let http: ReturnType<INestApplication['getHttpServer']>;
let prisma: PrismaService;
let manager: Session, orgFinance: Session, centralFinance: Session, cashier: Session, superadmin: Session;
let eventId: string;
let bankAccountId: string;
/** Distinct amount per run so leftovers of earlier runs can never auto-match this run's payments. */
const FEE = `7${String(Math.floor(Math.random() * 90) + 10)}.${String(Math.floor(Math.random() * 90) + 10)}`;
const API = '/api/v1';

interface Reg {
  id: string;
  referenceNo: string;
  accessToken: string;
  orderId: string;
}
const regs: Record<string, Reg> = {};

/** A valid 13-digit tax id (check digit computed). */
const taxId = (twelve: string) => {
  const s = [...twelve].reduce((a, d, i) => a + Number(d) * (13 - i), 0);
  return twelve + String((11 - (s % 11)) % 10);
};

const register = (email: string, extra: object = {}) =>
  request(http)
    .post(`${API}/events/${eventId}/registrations`)
    .set('Idempotency-Key', randomUUID())
    .send({ participantTypeCode: 'EXTERNAL', firstName: 'P2c', lastName: email.split('@')[0], email, pdpaConsent: true, ...extra });

const slip = (r: Reg, transferredAt: Date, seed: string) =>
  request(http)
    .post(`${API}/public/registrations/slip`)
    .field('referenceNo', r.referenceNo)
    .field('token', r.accessToken)
    .field('transferredAt', transferredAt.toISOString())
    .attach('file', fakePng(seed), 'slip.png');

/** dd/mm/BE + HH:mm in Bangkok time, as a Thai bank statement prints it. */
const bkk = (d: Date) => {
  const t = new Date(d.getTime() + 7 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return [`${p(t.getUTCDate())}/${p(t.getUTCMonth() + 1)}/${t.getUTCFullYear() + 543}`, `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`];
};

const approveAll = async (id: string) => {
  for (const u of ['sci.dean', 'finance', 'executive']) {
    const res = await (await login(http, u)).post(`${API}/events/${id}/approve`);
    expect(res.status).toBe(200);
  }
};

beforeAll(async () => {
  if (!PASSWORD) throw new Error('SEED_DEMO_PASSWORD must be set for e2e tests');
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
  prisma = app.get(PrismaService);
  [manager, orgFinance, centralFinance, cashier, superadmin] = await Promise.all(['sci.manager', 'sci.finance', 'finance', 'cashier', 'superadmin'].map((u) => login(http, u)));

  const [orgs, options] = await Promise.all([request(http).get(`${API}/organizations`), manager.get(`${API}/finance/options`)]);
  const sci = orgs.body.data.find((o: { code: string }) => o.code === 'SCI');
  bankAccountId = options.body.data.bankAccounts[0].id;
  const ev = await manager.post(`${API}/events`, {
    titleTh: `งานทดสอบ P2c ${randomUUID().slice(0, 6)}`,
    organizationId: sci.id,
    startAt: iso(6),
    endAt: iso(6.2),
    registrationOpenAt: iso(-1),
    registrationCloseAt: iso(5),
    allowGuestRegistration: true,
    bankAccountId,
    feeRates: [{ nameTh: 'อัตราทั่วไป', amount: FEE }],
  });
  expect(ev.status).toBe(201);
  eventId = ev.body.data.id;
  await manager.post(`${API}/events/${eventId}/submit`);
  await approveAll(eventId);
  expect((await manager.post(`${API}/events/${eventId}/publish`)).status).toBe(200);
});

afterAll(async () => {
  if (eventId) await manager.post(`${API}/events/${eventId}/cancel`, { reason: 'ข้อมูลทดสอบอัตโนมัติ (e2e)' });
  await app?.close();
});

describe('FIN-9 receipt addressee', () => {
  it('rejects a juristic billing with a bad tax id', async () => {
    const res = await register(`p2c-bad-${randomUUID().slice(0, 6)}@example.com`, {
      billing: { type: 'JURISTIC', name: 'บริษัท ตัวอย่าง จำกัด', taxId: '0105536000310', branch: '00000', address: 'กรุงเทพฯ' },
    });
    expect(res.status).toBe(422);
  });

  it('stores juristic billing given at registration', async () => {
    for (const k of ['a', 'b', 'c', 'd']) {
      const res = await register(`p2c-${k}-${randomUUID().slice(0, 6)}@example.com`, k === 'a' ? { billing: { type: 'JURISTIC', name: 'บริษัท ตัวอย่าง จำกัด', taxId: taxId('010553600031'), address: '1 ถนนตัวอย่าง' } } : {});
      expect(res.status).toBe(201);
      regs[k] = { id: res.body.data.id, referenceNo: res.body.data.referenceNo, accessToken: res.body.data.accessToken, orderId: res.body.data.payment.id };
      expect(res.body.data.payment.amount).toBe(FEE);
    }
    const a = await request(http).post(`${API}/public/registrations/lookup`).send({ referenceNo: regs.a!.referenceNo, token: regs.a!.accessToken });
    expect(a.body.data.payment.billing).toMatchObject({ type: 'JURISTIC', taxId: taxId('010553600031'), branch: '00000' });
  });

  it('the payer can change it with the status token', async () => {
    const res = await request(http)
      .post(`${API}/public/registrations/billing`)
      .send({ referenceNo: regs.b!.referenceNo, token: regs.b!.accessToken, billing: { type: 'JURISTIC', name: 'หน่วยงานทดสอบ', taxId: taxId('099400015933'), branch: '00012', address: 'สุราษฎร์ธานี' } });
    expect(res.status).toBe(200);
    expect(res.body.data.branch).toBe('00012');
    const wrong = await request(http).post(`${API}/public/registrations/billing`).send({ referenceNo: regs.b!.referenceNo, token: 'x'.repeat(32), billing: { type: 'INDIVIDUAL' } });
    expect(wrong.status).toBe(404);
  });
});

describe('bank-statement reconciliation', () => {
  const t0 = new Date(Date.now() - 3 * 3600_000);
  const tB = new Date(t0.getTime() + 60 * 60_000);
  let lineA: string, lineB: string, lineOther: string;
  let payA: string, payB: string;

  beforeAll(async () => {
    // a: verified transfer; b: slip still waiting for review
    expect((await slip(regs.a!, t0, `p2c-a-${FEE}`)).status).toBe(201);
    expect((await slip(regs.b!, tB, `p2c-b-${FEE}`)).status).toBe(201);
    const list = await orgFinance.get(`${API}/finance/payments?eventId=${eventId}&perPage=50`);
    payA = list.body.data.find((p: { referenceNo: string }) => p.referenceNo === regs.a!.referenceNo).id;
    payB = list.body.data.find((p: { referenceNo: string }) => p.referenceNo === regs.b!.referenceNo).id;
    expect((await orgFinance.post(`${API}/finance/payments/${payA}/verify`)).status).toBe(200);
  });

  const csv = (rows: string[][]) => Buffer.from('﻿' + [['วันที่', 'เวลา', 'รายละเอียด', 'ถอน', 'ฝาก', 'เลขอ้างอิง'], ...rows].map((r) => r.join(',')).join('\r\n'), 'utf8');
  const fileOne = () => {
    const [dA, hA] = bkk(new Date(t0.getTime() + 4 * 60_000));
    const [dB, hB] = bkk(new Date(tB.getTime() - 3 * 60_000));
    const [dX, hX] = bkk(new Date(t0.getTime() + 30 * 60_000));
    return csv([
      [dA, hA, 'โอนเข้า A', '', `"${FEE}"`, `A-${FEE}`],
      [dX, hX, 'ค่าธรรมเนียม', '25.00', '', ''],
      [dX, hX, 'เงินโอนอื่น', '', '"12,345.67"', `X-${FEE}`],
      [dB, hB, 'โอนเข้า B', '', FEE, `B-${FEE}`],
    ]);
  };

  it('needs finance_batch:reconcile', async () => {
    expect((await cashier.get(`${API}/finance/reconciliation/accounts`)).status).toBe(403);
  });

  it('imports credits only and auto-matches by amount and time', async () => {
    const res = await centralFinance.upload(`${API}/finance/reconciliation/statements`, fileOne(), 'stmt-1.csv', { bankAccountId });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ imported: 3, duplicates: 0, skippedDebit: 1 });
    expect(res.body.data.autoMatched).toBeGreaterThanOrEqual(2);

    const lines = await centralFinance.get(`${API}/finance/reconciliation/lines?bankAccountId=${bankAccountId}&search=${FEE}&perPage=50`);
    const byRef = (r: string) => lines.body.data.find((l: { reference: string }) => l.reference === r);
    expect(byRef(`A-${FEE}`)).toMatchObject({ matchStatus: 'AUTO', payment: { id: payA } });
    expect(byRef(`B-${FEE}`)).toMatchObject({ matchStatus: 'AUTO', payment: { id: payB } });
    lineA = byRef(`A-${FEE}`).id;
    lineB = byRef(`B-${FEE}`).id;
    const other = await centralFinance.get(`${API}/finance/reconciliation/lines?bankAccountId=${bankAccountId}&search=X-${FEE}`);
    lineOther = other.body.data[0].id;
    expect(other.body.data[0].matchStatus).toBe('UNMATCHED');

    const fin = await orgFinance.get(`${API}/finance/payments?eventId=${eventId}&perPage=50`);
    expect(fin.body.data.find((p: { id: string }) => p.id === payA).statementMatchedAt).not.toBeNull();
  });

  it('refuses the same file twice and skips lines already imported from an overlapping file', async () => {
    const again = await centralFinance.upload(`${API}/finance/reconciliation/statements`, fileOne(), 'stmt-1.csv', { bankAccountId });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('STATEMENT_DUPLICATE');

    const [dA, hA] = bkk(new Date(t0.getTime() + 4 * 60_000));
    const [dN, hN] = bkk(new Date(t0.getTime() + 90 * 60_000));
    const overlap = csv([
      [dA, hA, 'โอนเข้า A', '', `"${FEE}"`, `A-${FEE}`],
      [dN, hN, 'เงินโอนใหม่', '', '1.11', `N-${FEE}`],
    ]);
    const res = await centralFinance.upload(`${API}/finance/reconciliation/statements`, overlap, 'stmt-2.csv', { bankAccountId });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ imported: 1, duplicates: 1 });
  });

  it('rejects an unreadable file without importing anything', async () => {
    const bad = csv([['32/13/2569', '10:00', 'x', '', '100', 'BAD']]);
    const res = await centralFinance.upload(`${API}/finance/reconciliation/statements`, bad, 'bad.csv', { bankAccountId });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].row).toBe(2);
  });

  it('manual unmatch → candidates → match, and ignore with a reason', async () => {
    expect((await centralFinance.post(`${API}/finance/reconciliation/lines/${lineA}/unmatch`, { reason: 'ตรวจสอบซ้ำ' })).status).toBe(200);
    const cands = await centralFinance.get(`${API}/finance/reconciliation/lines/${lineA}/candidates`);
    expect(cands.body.data[0].id).toBe(payA);
    // payment B is already matched to another line
    const taken = await centralFinance.post(`${API}/finance/reconciliation/lines/${lineA}/match`, { paymentId: payB });
    expect(taken.status).toBe(409);
    expect((await centralFinance.post(`${API}/finance/reconciliation/lines/${lineA}/match`, { paymentId: payA })).status).toBe(200);

    expect((await centralFinance.post(`${API}/finance/reconciliation/lines/${lineOther}/ignore`, { reason: 'รายได้อื่น ไม่ใช่ค่าลงทะเบียน' })).status).toBe(200);
    const audit = await superadmin.get(`${API}/audit-logs?entityId=${lineA}`);
    expect(audit.body.data.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['reconcile.unmatch', 'reconcile.match']));
  });

  it('rejecting a matched slip releases the statement line', async () => {
    expect((await orgFinance.post(`${API}/finance/payments/${payB}/reject`, { reason: 'ยอดไม่ตรงทดสอบ' })).status).toBe(200);
    const line = await prisma.bankStatementLine.findUniqueOrThrow({ where: { id: lineB } });
    expect(line.matchStatus).toBe('UNMATCHED');
    expect(line.paymentId).toBeNull();
  });

  it('reports unmatched credits for the period', async () => {
    const res = await centralFinance.get(`${API}/finance/reconciliation/report?bankAccountId=${bankAccountId}&from=${new Date(t0.getTime() - 3600_000).toISOString()}&to=${new Date(t0.getTime() + 3 * 3600_000).toISOString()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.unmatchedLines.map((l: { id: string }) => l.id)).toContain(lineB);
    expect(res.body.data.lines.matched.count).toBeGreaterThanOrEqual(1);
  });
});

describe('FIN-1 documents', () => {
  let batchId: string;

  it('exports the remittance report as PDF (draft watermark) and Excel from the template', async () => {
    const created = await orgFinance.post(`${API}/finance/batches`, { eventId });
    expect(created.status).toBe(201);
    batchId = created.body.data.id;
    const pdf = await orgFinance.get(`${API}/finance/batches/${batchId}/export?format=pdf`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('a template edited in settings is validated and used by the export', async () => {
    const settings = await superadmin.get(`${API}/settings`);
    const original = settings.body.data.find((s: { key: string }) => s.key === 'finance.remittanceReportTemplate').value;
    const bad = await superadmin.patch(`${API}/settings/finance.remittanceReportTemplate`, { value: { ...original, columns: [{ key: 'nope', label: 'x', width: 5 }] } });
    expect(bad.status).toBe(422);
    const marker = `แบบทดสอบ ${randomUUID().slice(0, 6)}`;
    expect((await superadmin.patch(`${API}/settings/finance.remittanceReportTemplate`, { value: { ...original, titleLines: [marker] } })).status).toBe(200);
    try {
      const xlsx = await orgFinance.get(`${API}/finance/batches/${batchId}/export?format=xlsx`).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(xlsx.body as ArrayBuffer);
      expect(wb.worksheets[0]!.getCell('A1').value).toBe(marker);
    } finally {
      await superadmin.patch(`${API}/settings/finance.remittanceReportTemplate`, { value: original });
    }
  });
});

describe('FIN-12 offline cash capture', () => {
  let sessionId: string;

  it('downloads the offline pack and syncs a collection with the real capture time', async () => {
    const open = await cashier.post(`${API}/finance/cashier-sessions`, { eventId });
    expect(open.status).toBe(201);
    sessionId = open.body.data.id;
    const pack = await cashier.get(`${API}/finance/cashier-sessions/${sessionId}/offline-pack`);
    expect(pack.status).toBe(200);
    const c = pack.body.data.payables.find((p: { orderId: string }) => p.orderId === regs.c!.orderId);
    expect(c.amount).toBe(FEE);

    const tooEarly = await cashier.post(`${API}/finance/cashier-sessions/${sessionId}/collect`, { orderId: regs.c!.orderId, capturedAt: iso(-1) }, { 'Idempotency-Key': randomUUID() });
    expect(tooEarly.status).toBe(422);

    await new Promise((r) => setTimeout(r, 50));
    const capturedAt = new Date().toISOString();
    const key = randomUUID();
    const res = await cashier.post(`${API}/finance/cashier-sessions/${sessionId}/collect`, { orderId: regs.c!.orderId, capturedAt }, { 'Idempotency-Key': key });
    expect(res.status).toBe(201);
    // a retried sync replays instead of charging twice
    const replay = await cashier.post(`${API}/finance/cashier-sessions/${sessionId}/collect`, { orderId: regs.c!.orderId, capturedAt }, { 'Idempotency-Key': key });
    expect(replay.body.data.paymentNo).toBe(res.body.data.paymentNo);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(p.capturedOfflineAt?.toISOString()).toBe(capturedAt);
  });

  it('an offline sale for an order that is no longer payable is a conflict for finance to settle', async () => {
    // b's order went back to UNPAID after the rejection; pay it by slip again so it is pending review
    expect((await slip(regs.b!, new Date(), `p2c-b2-${FEE}`)).status).toBe(201);
    const res = await cashier.post(`${API}/finance/cashier-sessions/${sessionId}/collect`, { orderId: regs.b!.orderId, capturedAt: new Date().toISOString() }, { 'Idempotency-Key': randomUUID() });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OFFLINE_CONFLICT');
  });

  it('prints the paper fallback list and, after closing, the cash remittance document', async () => {
    const sheet = await cashier.get(`${API}/finance/cashier-sessions/${sessionId}/offline-sheet`);
    expect(sheet.status).toBe(200);
    expect(sheet.headers['content-type']).toBe('application/pdf');
    expect((await cashier.get(`${API}/finance/cashier-sessions/${sessionId}/remittance-document?format=pdf`)).status).toBe(409);
    expect((await cashier.post(`${API}/finance/cashier-sessions/${sessionId}/close`, { countedAmount: FEE })).status).toBe(200);
    const doc = await cashier.get(`${API}/finance/cashier-sessions/${sessionId}/remittance-document?format=pdf`);
    expect(doc.status).toBe(200);
    expect(doc.headers['content-type']).toBe('application/pdf');
  });
});

describe('FEE_CHANGE: fee edits after approval need re-approval', () => {
  const NEW_FEE = '999.00';

  it('direct edits are refused with a pointer to the fee-change request', async () => {
    const ev = await manager.get(`${API}/events/${eventId}`);
    const res = await manager.patch(`${API}/events/${eventId}`, { version: ev.body.data.version, feeRates: [{ nameTh: 'ใหม่', amount: NEW_FEE }] });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('ขอแก้ไขอัตราค่าลงทะเบียน');
  });

  it('a request can be withdrawn', async () => {
    expect((await manager.post(`${API}/events/${eventId}/fee-change`, { feeRates: [{ nameTh: 'ใหม่', amount: '1.00' }], reason: 'ทดลองยื่นแล้วถอน' })).status).toBe(201);
    expect((await manager.post(`${API}/events/${eventId}/fee-change/cancel`)).status).toBe(200);
    expect((await manager.get(`${API}/events/${eventId}/fee-change`)).body.data).toBeNull();
  });

  it('the proposal goes through the workflow while registration continues at the old fee', async () => {
    const req = await manager.post(`${API}/events/${eventId}/fee-change`, { feeRates: [{ nameTh: 'อัตราใหม่', amount: NEW_FEE }], reason: 'ปรับค่าเอกสารประกอบการประชุม' });
    expect(req.status).toBe(201);
    const dup = await manager.post(`${API}/events/${eventId}/fee-change`, { feeRates: [{ nameTh: 'x', amount: '5.00' }], reason: 'ซ้ำ' });
    expect(dup.status).toBe(409);

    const pending = await manager.get(`${API}/events/${eventId}/fee-change`);
    expect(pending.body.data.proposed.feeRates[0].amount).toBe(NEW_FEE);
    expect(pending.body.data.current.feeRates[0].amount).toBe(FEE);
    const ev = await manager.get(`${API}/events/${eventId}`);
    expect(ev.body.data.status).toBe('PUBLISHED');
    const mid = await register(`p2c-mid-${randomUUID().slice(0, 6)}@example.com`);
    expect(mid.body.data.payment.amount).toBe(FEE);

    // proposer cannot approve; approvers see the comparison
    expect((await manager.post(`${API}/events/${eventId}/approve`)).status).toBe(403);
    const dean = await login(http, 'sci.dean');
    const queue = await dean.get(`${API}/approvals/pending`);
    const item = queue.body.data.find((r: { event: { id: string } }) => r.event.id === eventId);
    expect(item.trigger).toBe('FEE_CHANGE');
    expect(item.feeChange.proposed.feeRates[0].amount).toBe(NEW_FEE);

    await approveAll(eventId);
    const after = await manager.get(`${API}/events/${eventId}`);
    expect(after.body.data.status).toBe('PUBLISHED');
    expect(after.body.data.feeRates.map((r: { amount: string }) => r.amount)).toEqual([NEW_FEE]);
    const late = await register(`p2c-late-${randomUUID().slice(0, 6)}@example.com`);
    expect(late.body.data.payment.amount).toBe(NEW_FEE);
    // orders issued before the change keep their snapshot
    const old = await request(http).post(`${API}/public/registrations/lookup`).send({ referenceNo: regs.d!.referenceNo, token: regs.d!.accessToken });
    expect(old.body.data.payment.amount).toBe(FEE);

    const history = await manager.get(`${API}/events/${eventId}/approval-history`);
    expect(history.body.data.map((r: { trigger: string; status: string }) => `${r.trigger}:${r.status}`)).toEqual(['INITIAL:APPROVED', 'FEE_CHANGE:CANCELLED', 'FEE_CHANGE:APPROVED']);
  });
});
