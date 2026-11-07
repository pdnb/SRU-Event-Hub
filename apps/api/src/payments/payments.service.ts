import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BankAccountSnapshot, FinancePaymentRowDto, PaymentDto, PaymentOrderDto } from '@sru/shared-types';
import { bahtText, formatReceiptNo, promptPayPayload } from '@sru/shared-utils';
import { PROMPTPAY_SUPPORTED } from './promptpay-policy';
import { createHash } from 'node:crypto';
import type { AuthUser } from '../auth/auth.types';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import type { RequestMeta } from '../common/decorators';
import { AppError, Errors } from '../common/errors';
import { moneyOut } from '../common/money';
import { Paginated } from '../common/pagination';
import { SequenceService } from '../common/sequence.service';
import type { Env } from '../config/env';
import { Payment, PaymentOrder, Prisma } from '../generated/prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { BillingInputDto, billingColumns, billingDto } from './billing';
import { paymentDueAt, selectFeeRate } from './fee';
import { FinancePaymentQueryDto, SubmitSlipDto } from './payments.dto';
import { PaymentQueue } from './payment-queue';

/** Order statuses that still hold a seat / represent a live obligation. */
/** The part of a multer file we rely on (memory storage). */
export interface UploadedSlip {
  buffer: Buffer;
  originalname: string;
  size: number;
}

export const LIVE_ORDER = ['UNPAID', 'PENDING_VERIFICATION'] as const;

/** Who an order is for: one individual registration, or a registration group (P3 combined order). */
export interface OrderPayer {
  registrationId: string | null;
  groupId: string | null;
}

/** The registrations an order pays for. */
export function payeeWhere(o: OrderPayer): Prisma.RegistrationWhereInput {
  if (o.registrationId) return { id: o.registrationId };
  if (o.groupId) return { groupId: o.groupId };
  return { id: { in: [] } };
}

/**
 * Locks the payer row (registration or group) – always the first lock of any payment transaction
 * (global order: registration | group → event → cashier session → order → payment).
 */
export async function lockPayer(tx: Tx, o: OrderPayer) {
  if (o.registrationId) await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${o.registrationId}::uuid FOR UPDATE`;
  else if (o.groupId) await tx.$queryRaw`SELECT id FROM registration_groups WHERE id = ${o.groupId}::uuid FOR UPDATE`;
}

/** Order fully paid / waived → its registrations (and group) are confirmed. */
export async function settlePayees(tx: Tx, o: OrderPayer, now: Date) {
  await tx.registration.updateMany({
    where: { ...payeeWhere(o), status: 'PENDING_PAYMENT' },
    data: { status: 'CONFIRMED', confirmedAt: now, paymentDueAt: null, version: { increment: 1 } },
  });
  if (o.groupId) {
    await tx.registrationGroup.updateMany({
      where: { id: o.groupId, status: 'PENDING_PAYMENT' },
      data: { status: 'CONFIRMED', confirmedAt: now, version: { increment: 1 } },
    });
  }
}

/** A cash payment was voided → back to waiting for payment with a new due time. */
export async function unsettlePayees(tx: Tx, o: OrderPayer, dueAt: Date) {
  await tx.registration.updateMany({
    where: { ...payeeWhere(o), status: 'CONFIRMED' },
    data: { status: 'PENDING_PAYMENT', confirmedAt: null, paymentDueAt: dueAt, version: { increment: 1 } },
  });
  if (o.groupId) {
    await tx.registrationGroup.updateMany({
      where: { id: o.groupId, status: 'CONFIRMED' },
      data: { status: 'PENDING_PAYMENT', confirmedAt: null, version: { increment: 1 } },
    });
  }
}

/** Receipt-addressee columns of payment_orders (already validated). */
export interface BillingColumns {
  billingType: 'INDIVIDUAL' | 'JURISTIC';
  billingName: string | null;
  billingTaxId: string | null;
  billingBranch: string | null;
  billingAddress: string | null;
}

export interface GroupOrderLineInput {
  registrationId: string;
  feeRateId: string | null;
  feeName: string;
  amount: Prisma.Decimal;
}

type OrderWithPayments = PaymentOrder & { payments: Payment[] };

interface RegistrationForOrder {
  id: string;
  eventId: string;
  participantTypeId: string;
  firstName: string;
  lastName: string;
  prefix: string | null;
  email: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly seq: SequenceService,
    private readonly storage: StorageService,
    private readonly queue: PaymentQueue,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // ───────────── Orders (called inside the registration transaction) ─────────────

  /**
   * Resolves the fee for a registration. `null` = nothing to pay (free event or a 0-baht rate).
   * Throws when the event charges fees but no rate applies to this participant type right now.
   */
  async resolveFee(tx: Tx, eventId: string, participantTypeId: string, at: Date) {
    const rates = await tx.eventFeeRate.findMany({ where: { eventId, isActive: true } });
    const rate = selectFeeRate(rates, participantTypeId, at);
    if (!rate) {
      throw new AppError('FEE_NOT_AVAILABLE', 'ไม่มีอัตราค่าลงทะเบียนสำหรับประเภทผู้เข้าร่วมนี้ในช่วงเวลานี้', HttpStatus.CONFLICT);
    }
    return rate.amount.isZero() ? null : rate;
  }

  /** Creates the payment order + CHARGE ledger entry. Caller holds the event row lock. */
  async createOrder(
    tx: Tx,
    reg: RegistrationForOrder,
    rate: { id: string; nameTh: string; amount: Prisma.Decimal },
    event: { startAt: Date; paymentWindowHours: number; bankAccountId: string | null; incomeCodeId: string | null },
    now = new Date(),
    billing?: BillingInputDto,
  ) {
    // Validate before any write so a bad tax id fails the registration cleanly.
    const billingData = billing ? billingColumns(billing) : {};
    const order = await tx.paymentOrder.create({
      data: {
        orderNo: await this.seq.next(tx, 'INV', now),
        eventId: reg.eventId,
        registrationId: reg.id,
        payerName: `${reg.prefix ?? ''}${reg.firstName} ${reg.lastName}`.trim(),
        payerEmail: reg.email,
        amount: rate.amount,
        feeRateId: rate.id,
        feeSnapshot: { rateId: rate.id, nameTh: rate.nameTh, amount: rate.amount.toFixed(2) },
        ...(await this.accountSnapshot(tx, event)),
        dueAt: paymentDueAt(now, event.paymentWindowHours, event.startAt),
        ...billingData,
      },
    });
    await tx.paymentLedgerEntry.create({
      data: { orderId: order.id, entryType: 'CHARGE', amount: rate.amount, reason: rate.nameTh },
    });
    return order;
  }

  /**
   * Combined order of a registration group (P3): one line per member (fee snapshot each), one
   * CHARGE ledger row for the total. Caller holds the group + event row locks. `dueAt` may be
   * passed to keep the deadline of an order being re-issued after a member change.
   */
  async createGroupOrder(
    tx: Tx,
    group: { id: string; eventId: string; payerName: string; payerEmail: string },
    lines: GroupOrderLineInput[],
    event: { startAt: Date; paymentWindowHours: number; bankAccountId: string | null; incomeCodeId: string | null },
    now = new Date(),
    opts: { billing?: BillingColumns; dueAt?: Date } = {},
  ) {
    const total = lines.reduce((s, l) => s.plus(l.amount), new Prisma.Decimal(0));
    if (total.lte(0)) return null;
    const billingData = opts.billing ?? {};
    const summary = new Map<string, { nameTh: string; amount: string; count: number }>();
    for (const l of lines) {
      const k = `${l.feeName}|${l.amount.toFixed(2)}`;
      const cur = summary.get(k) ?? { nameTh: l.feeName, amount: l.amount.toFixed(2), count: 0 };
      cur.count++;
      summary.set(k, cur);
    }
    const order = await tx.paymentOrder.create({
      data: {
        orderNo: await this.seq.next(tx, 'INV', now),
        eventId: group.eventId,
        groupId: group.id,
        payerName: group.payerName,
        payerEmail: group.payerEmail,
        amount: total,
        feeSnapshot: { nameTh: `ค่าลงทะเบียนแบบกลุ่ม ${lines.length} คน`, amount: total.toFixed(2), members: lines.length, rates: [...summary.values()] },
        ...(await this.accountSnapshot(tx, event)),
        dueAt: opts.dueAt ?? paymentDueAt(now, event.paymentWindowHours, event.startAt),
        ...billingData,
      },
    });
    await tx.paymentOrderLine.createMany({
      data: lines.map((l) => ({ orderId: order.id, registrationId: l.registrationId, feeRateId: l.feeRateId, feeName: l.feeName, amount: l.amount })),
    });
    await tx.paymentLedgerEntry.create({
      data: { orderId: order.id, entryType: 'CHARGE', amount: total, reason: `ค่าลงทะเบียนแบบกลุ่ม ${lines.length} คน` },
    });
    return order;
  }

  private async accountSnapshot(tx: Tx, event: { bankAccountId: string | null; incomeCodeId: string | null }) {
    const [bank, income] = await Promise.all([
      event.bankAccountId ? tx.bankAccount.findUnique({ where: { id: event.bankAccountId } }) : null,
      event.incomeCodeId ? tx.incomeCode.findUnique({ where: { id: event.incomeCodeId } }) : null,
    ]);
    const snap: BankAccountSnapshot | null = bank
      ? { bankName: bank.bankName, branch: bank.branch, accountNo: bank.accountNo, accountName: bank.accountName, promptPayId: PROMPTPAY_SUPPORTED ? bank.promptPayId : null }
      : null;
    return {
      bankAccountSnapshot: snap ? (snap as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      incomeCode: income?.code ?? null,
    };
  }

  /**
   * FIN-9: sets who the receipt is made out to. Allowed while no official receipt number has been
   * recorded for the order (after that กองคลัง must void the receipt first).
   */
  async updateBilling(orderId: string, billing: BillingInputDto, actorId: string | null, meta: RequestMeta) {
    const data = billingColumns(billing);
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ status: string }[]>`SELECT status::text FROM payment_orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      if (!locked) throw Errors.notFound('ใบแจ้งชำระ');
      if (['CANCELLED', 'EXPIRED', 'REFUNDED'].includes(locked.status)) throw Errors.invalidState('ใบแจ้งชำระนี้ปิดแล้ว');
      const receipts = await tx.receiptRecord.count({ where: { payment: { orderId }, status: { not: 'VOIDED' } } });
      if (receipts) throw Errors.invalidState('กองคลังออกใบเสร็จแล้ว แก้ไขข้อมูลผู้รับใบเสร็จไม่ได้ (ติดต่อกองคลังเพื่อยกเลิกใบเสร็จก่อน)');
      const before = await tx.paymentOrder.findUniqueOrThrow({ where: { id: orderId } });
      const o = await tx.paymentOrder.update({ where: { id: orderId }, data: { ...data, version: { increment: 1 } } });
      await this.audit.log({ actorId, action: 'payment_order.billing', entityType: 'payment_order', entityId: orderId, before: billingDto(before), after: billingDto(o), meta }, tx);
      return billingDto(o);
    });
  }

  /** Schedules the exact-time expiry job (the periodic sweeper is the safety net). Call after commit. */
  scheduleExpiry(order: { id: string; dueAt: Date }) {
    void this.queue.scheduleExpiry(order.id, order.dueAt);
  }

  /** Closes the live order of a cancelled registration (inside the cancel transaction). */
  async closeOrdersForCancelledRegistration(tx: Tx, registrationId: string, reason: string, actorId: string | null) {
    return this.closeOrders(tx, { registrationId, groupId: null }, reason, actorId);
  }

  /**
   * Closes the live orders of a cancelled registration or group: pending slips are voided, unpaid
   * orders CANCELLED, paid ones REFUND_PENDING (money goes back through the refund process).
   */
  async closeOrders(tx: Tx, payer: OrderPayer, reason: string, actorId: string | null) {
    const orders = await tx.paymentOrder.findMany({
      where: {
        ...(payer.registrationId ? { registrationId: payer.registrationId } : { groupId: payer.groupId ?? '00000000-0000-0000-0000-000000000000' }),
        status: { in: [...LIVE_ORDER, 'PAID'] },
      },
      include: { payments: { where: { status: 'SUBMITTED' } } },
    });
    for (const o of orders) {
      for (const p of o.payments) {
        await tx.payment.update({
          where: { id: p.id },
          data: { status: 'VOIDED', voidedAt: new Date(), voidedById: actorId, voidReason: reason, version: { increment: 1 } },
        });
      }
      // Paid orders are not reversed here: money must be returned through the refund process (P2b).
      const next = o.status === 'PAID' ? 'REFUND_PENDING' : 'CANCELLED';
      await tx.paymentOrder.update({
        where: { id: o.id },
        data: { status: next, closedAt: next === 'CANCELLED' ? new Date() : null, closeReason: reason, version: { increment: 1 } },
      });
    }
  }

  // ───────────── Slip submission (payer side) ─────────────

  /**
   * Payer uploads a transfer slip. The bytes are validated (magic number, size), de-duplicated by
   * SHA-256 against every live payment, stored in the private bucket, and the order moves to
   * PENDING_VERIFICATION. A slip submitted before the due time protects the seat while it is reviewed.
   */
  async submitSlip(
    target: string | { groupId: string },
    file: UploadedSlip | undefined,
    dto: SubmitSlipDto,
    actorId: string | null,
    meta: RequestMeta,
  ) {
    if (!file?.buffer) throw new AppError('FILE_REQUIRED', 'กรุณาแนบหลักฐานการโอนเงิน', HttpStatus.BAD_REQUEST);
    const who = typeof target === 'string' ? { registrationId: target } : { groupId: target.groupId };
    const order = await this.prisma.paymentOrder.findFirst({ where: { ...who, status: { in: [...LIVE_ORDER] } } });
    if (!order) throw Errors.invalidState('ไม่มีรายการที่ต้องชำระสำหรับการลงทะเบียนนี้');
    this.assertCanSubmit(order);

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    if (await this.prisma.payment.findFirst({ where: { slipSha256: sha256, status: { in: ['SUBMITTED', 'VERIFIED'] } } })) {
      throw Errors.conflict('DUPLICATE_SLIP', 'หลักฐานการโอนนี้ถูกใช้แล้ว กรุณาแนบหลักฐานของรายการนี้');
    }
    const stored = await this.storage.putValidated(file.buffer, {
      prefix: 'slips',
      allowed: ['jpg', 'png', 'pdf'],
      maxBytes: this.config.get('SLIP_MAX_BYTES', { infer: true }),
    });

    try {
      const payment = await this.prisma.$transaction(async (tx) => {
        const [locked] = await tx.$queryRaw<{ status: string; due_at: Date }[]>`
          SELECT status::text, due_at FROM payment_orders WHERE id = ${order.id}::uuid FOR UPDATE`;
        if (!locked) throw Errors.notFound('ใบแจ้งชำระ');
        this.assertCanSubmit({ status: locked.status as PaymentOrder['status'], dueAt: locked.due_at });

        const fileRow = await tx.file.create({
          data: {
            ...stored,
            sizeBytes: BigInt(stored.sizeBytes),
            originalName: (file.originalname || 'slip').slice(0, 300),
            isPrivate: true,
            uploadedById: actorId,
          },
        });
        const p = await tx.payment.create({
          data: {
            paymentNo: await this.seq.next(tx, 'PAY'),
            orderId: order.id,
            channel: 'TRANSFER',
            amount: order.amount,
            slipFileId: fileRow.id,
            slipSha256: sha256,
            transferredAt: dto.transferredAt ? new Date(dto.transferredAt) : null,
            payerNote: dto.note || null,
            submittedById: actorId,
          },
        });
        await tx.paymentOrder.update({ where: { id: order.id }, data: { status: 'PENDING_VERIFICATION', version: { increment: 1 } } });
        await this.audit.log(
          { actorId, action: 'payment.submit', entityType: 'payment', entityId: p.id, after: { orderNo: order.orderNo, paymentNo: p.paymentNo, amount: order.amount.toFixed(2), sha256 }, meta },
          tx,
        );
        return p;
      });
      return this.paymentDto(payment);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw Errors.conflict('DUPLICATE_SLIP', 'หลักฐานการโอนนี้ถูกใช้แล้ว หรือมีรายการรอตรวจสอบอยู่แล้ว');
      }
      throw e;
    }
  }

  private assertCanSubmit(order: Pick<PaymentOrder, 'status' | 'dueAt'>) {
    if (order.status === 'PENDING_VERIFICATION') throw Errors.invalidState('มีหลักฐานการชำระเงินรอตรวจสอบอยู่แล้ว');
    if (order.status !== 'UNPAID') throw Errors.invalidState('ใบแจ้งชำระนี้ไม่อยู่ในสถานะรอชำระ');
    if (order.dueAt <= new Date()) throw new AppError('PAYMENT_EXPIRED', 'เลยกำหนดชำระเงินแล้ว', HttpStatus.CONFLICT);
  }

  // ───────────── Verification (finance side) ─────────────

  async verify(paymentId: string, user: AuthUser, meta: RequestMeta) {
    const ctx = await this.loadForDecision(paymentId, user, 'payment:verify');
    return this.prisma.$transaction(async (tx) => {
      const p = await this.lockSubmitted(tx, paymentId, ctx);
      const now = new Date();
      await tx.payment.update({ where: { id: p.id }, data: { status: 'VERIFIED', verifiedById: user.id, verifiedAt: now, version: { increment: 1 } } });
      await tx.paymentLedgerEntry.create({ data: { orderId: p.orderId, paymentId: p.id, entryType: 'PAYMENT', amount: p.amount.negated(), createdById: user.id } });
      await tx.paymentOrder.update({ where: { id: p.orderId }, data: { status: 'PAID', paidAt: now, version: { increment: 1 } } });
      await settlePayees(tx, ctx, now);
      await this.audit.log({ actorId: user.id, action: 'payment.verify', entityType: 'payment', entityId: p.id, before: { status: 'SUBMITTED' }, after: { status: 'VERIFIED', amount: p.amount.toFixed(2) }, meta }, tx);
      return { id: p.id, status: 'VERIFIED' };
    });
  }

  /** Rejects a slip. The payer gets at least 24 h more (capped at event start) to submit a correct one. */
  async reject(paymentId: string, reason: string, user: AuthUser, meta: RequestMeta) {
    const ctx = await this.loadForDecision(paymentId, user, 'payment:verify');
    return this.prisma.$transaction(async (tx) => {
      const p = await this.lockSubmitted(tx, paymentId, ctx);
      const now = new Date();
      const extended = paymentDueAt(now, 24, ctx.eventStartAt);
      const dueAt = extended > ctx.orderDueAt ? extended : ctx.orderDueAt;
      await tx.payment.update({ where: { id: p.id }, data: { status: 'REJECTED', rejectReason: reason, verifiedById: user.id, verifiedAt: now, version: { increment: 1 } } });
      await tx.paymentOrder.update({ where: { id: p.orderId }, data: { status: 'UNPAID', dueAt, version: { increment: 1 } } });
      await tx.registration.updateMany({ where: { ...payeeWhere(ctx), status: 'PENDING_PAYMENT' }, data: { paymentDueAt: dueAt } });
      // A rejected slip no longer explains a bank credit: put the statement line back for review.
      await tx.bankStatementLine.updateMany({
        where: { paymentId: p.id, matchStatus: { in: ['AUTO', 'MANUAL'] } },
        data: { matchStatus: 'UNMATCHED', paymentId: null, matchedAt: now, matchedById: user.id, note: `หลักฐาน ${p.paymentNo} ไม่ผ่านการตรวจสอบ`, version: { increment: 1 } },
      });
      await this.audit.log({ actorId: user.id, action: 'payment.reject', entityType: 'payment', entityId: p.id, before: { status: 'SUBMITTED' }, after: { status: 'REJECTED', dueAt }, reason, meta }, tx);
      this.scheduleExpiry({ id: p.orderId, dueAt });
      return { id: p.id, status: 'REJECTED', newDueAt: dueAt.toISOString() };
    });
  }

  /** Fee waiver (e.g. invited speaker). Needs payment:waive and a reason; recorded as a WAIVER ledger row. */
  async waive(orderId: string, reason: string, user: AuthUser, meta: RequestMeta) {
    const order = await this.prisma.paymentOrder.findUnique({ where: { id: orderId }, include: { event: true, registration: true, group: true } });
    if (!order) throw Errors.notFound('ใบแจ้งชำระ');
    await this.access.assertOrg(user, 'payment:waive', order.event.organizationId);
    if (order.registration?.userId === user.id || order.group?.coordinatorUserId === user.id) {
      throw Errors.forbidden('ไม่สามารถยกเว้นค่าธรรมเนียมให้ตนเองได้ (การแบ่งแยกหน้าที่)');
    }
    return this.prisma.$transaction(async (tx) => {
      await lockPayer(tx, order);
      const [locked] = await tx.$queryRaw<{ status: string }[]>`SELECT status::text FROM payment_orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      if (locked?.status !== 'UNPAID') throw Errors.invalidState('ยกเว้นได้เฉพาะรายการที่ยังไม่ชำระและไม่มีหลักฐานรอตรวจสอบ');
      const now = new Date();
      await tx.paymentLedgerEntry.create({ data: { orderId, entryType: 'WAIVER', amount: order.amount.negated(), reason, createdById: user.id } });
      await tx.paymentOrder.update({ where: { id: orderId }, data: { status: 'WAIVED', closedAt: now, closeReason: reason, version: { increment: 1 } } });
      await settlePayees(tx, order, now);
      await this.audit.log({ actorId: user.id, action: 'payment.waive', entityType: 'payment_order', entityId: orderId, after: { status: 'WAIVED', amount: order.amount.toFixed(2) }, reason, meta }, tx);
      return { id: orderId, status: 'WAIVED' };
    });
  }

  /** Permission + data scope + separation of duties (verifier ≠ payer / submitter). */
  private async loadForDecision(paymentId: string, user: AuthUser, perm: 'payment:verify') {
    const p = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { order: { include: { event: true, registration: true, group: true } } },
    });
    if (!p) throw Errors.notFound('รายการชำระเงิน');
    await this.access.assertOrg(user, perm, p.order.event.organizationId);
    if (p.submittedById === user.id || p.order.registration?.userId === user.id || p.order.group?.coordinatorUserId === user.id) {
      throw Errors.forbidden('ผู้ตรวจสอบต้องไม่ใช่ผู้ชำระเงิน (การแบ่งแยกหน้าที่)');
    }
    return {
      registrationId: p.order.registrationId,
      groupId: p.order.groupId,
      orderId: p.orderId,
      eventStartAt: p.order.event.startAt,
      orderDueAt: p.order.dueAt,
    };
  }

  /** Global lock order payer → order → payment (expiry/cancel use the same prefix → no deadlocks). */
  private async lockSubmitted(tx: Tx, paymentId: string, ctx: OrderPayer & { orderId: string }) {
    await lockPayer(tx, ctx);
    await tx.$queryRaw`SELECT id FROM payment_orders WHERE id = ${ctx.orderId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE`;
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (p.status !== 'SUBMITTED') throw Errors.invalidState('รายการนี้ได้รับการตรวจสอบไปแล้ว');
    return p;
  }

  // ───────────── Queries ─────────────

  /** Live (or latest) order of a registration, for the payer's status page. */
  async orderForRegistration(registrationId: string): Promise<PaymentOrderDto | null> {
    const order = await this.prisma.paymentOrder.findFirst({
      where: { registrationId },
      orderBy: { createdAt: 'desc' },
      include: { payments: { orderBy: { submittedAt: 'desc' }, take: 1 } },
    });
    return order ? this.orderDto(order) : null;
  }

  async financeList(q: FinancePaymentQueryDto, user: AuthUser) {
    const scope = await this.access.orgScope(user, 'payment:view');
    const search = q.search?.trim();
    const where: Prisma.PaymentWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.channel ? { channel: q.channel } : {}),
      order: {
        ...(q.eventId ? { eventId: q.eventId } : {}),
        ...(scope === 'ALL' ? {} : { event: { organizationId: { in: scope } } }),
      },
      ...(search
        ? {
            OR: [
              { paymentNo: search.toUpperCase() },
              { order: { orderNo: search.toUpperCase() } },
              { order: { payerName: { contains: search, mode: 'insensitive' } } },
              { order: { payerEmail: { contains: search.toLowerCase() } } },
              { order: { registration: { referenceNo: search.toUpperCase() } } },
              { order: { group: { groupNo: search.toUpperCase() } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        include: {
          order: {
            include: {
              event: { select: { id: true, code: true, titleTh: true } },
              registration: { select: { referenceNo: true } },
              group: { select: { groupNo: true } },
            },
          },
          verifiedBy: { select: { displayName: true } },
          batchItems: { where: { isActive: true }, include: { batch: { select: { batchNo: true } } } },
          receipts: { where: { status: { not: 'VOIDED' } } },
          statementLines: { where: { matchStatus: { in: ['AUTO', 'MANUAL'] } }, select: { id: true, txnAt: true } },
        },
        orderBy: { submittedAt: q.order },
        skip: q.skip,
        take: q.perPage,
      }),
      this.prisma.payment.count({ where }),
    ]);
    const data: FinancePaymentRowDto[] = rows.map((p) => ({
      ...this.paymentDto(p),
      orderId: p.orderId,
      orderNo: p.order.orderNo,
      orderStatus: p.order.status,
      payerName: p.order.payerName,
      payerEmail: p.order.payerEmail,
      registrationId: p.order.registrationId,
      referenceNo: p.order.registration?.referenceNo ?? p.order.group?.groupNo ?? null,
      eventId: p.order.event.id,
      eventCode: p.order.event.code,
      eventTitle: p.order.event.titleTh,
      verifiedByName: p.verifiedBy?.displayName ?? null,
      batchNo: p.batchItems[0]?.batch.batchNo ?? null,
      receiptNo: p.receipts[0] ? formatReceiptNo(p.receipts[0].fiscalYear, p.receipts[0].receiptNo) : null,
      statementMatchedAt: p.statementLines[0]?.txnAt.toISOString() ?? null,
      billing: billingDto(p.order),
    }));
    return Paginated.of(data, total, q);
  }

  /** Slip bytes for reviewers (streamed through the API so storage is never exposed). */
  async slip(paymentId: string, user: AuthUser) {
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { slipFile: true, order: { include: { event: true } } } });
    if (!p?.slipFile) throw Errors.notFound('หลักฐานการโอน');
    await this.access.assertOrg(user, 'payment:view', p.order.event.organizationId);
    const bytes = await this.storage.getBytes(p.slipFile.bucket, p.slipFile.objectKey);
    return { bytes, mimeType: p.slipFile.mimeType, name: `${p.paymentNo}.${p.slipFile.objectKey.split('.').pop()}` };
  }

  // ───────────── Mapping ─────────────

  orderDto(o: OrderWithPayments): PaymentOrderDto {
    const amount = moneyOut(o.amount)!;
    const bank = o.bankAccountSnapshot as BankAccountSnapshot | null;
    let qr: string | null = null;
    if (PROMPTPAY_SUPPORTED && bank?.promptPayId && o.status === 'UNPAID') {
      try {
        qr = promptPayPayload(bank.promptPayId, amount);
      } catch (e) {
        this.logger.warn({ orderNo: o.orderNo, err: String(e) }, 'Invalid PromptPay id on bank account snapshot');
      }
    }
    const latest = [...o.payments].sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())[0];
    return {
      id: o.id,
      orderNo: o.orderNo,
      status: o.status,
      amount,
      amountText: bahtText(amount),
      feeName: (o.feeSnapshot as { nameTh?: string }).nameTh ?? 'ค่าลงทะเบียน',
      dueAt: o.dueAt.toISOString(),
      paidAt: o.paidAt?.toISOString() ?? null,
      bankAccount: bank,
      promptPayPayload: qr,
      latestPayment: latest ? this.paymentDto(latest) : null,
      billing: billingDto(o),
    };
  }

  paymentDto(p: Payment): PaymentDto {
    return {
      id: p.id,
      paymentNo: p.paymentNo,
      channel: p.channel,
      status: p.status,
      amount: moneyOut(p.amount)!,
      transferredAt: p.transferredAt?.toISOString() ?? null,
      submittedAt: p.submittedAt.toISOString(),
      verifiedAt: p.verifiedAt?.toISOString() ?? null,
      rejectReason: p.rejectReason,
      hasSlip: !!p.slipFileId,
    };
  }
}
