import { Injectable } from '@nestjs/common';
import { bahtText } from '@sru/shared-utils';
import type { AuthUser } from '../auth/auth.types';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import type { RequestMeta } from '../common/decorators';
import { Errors } from '../common/errors';
import { FieldCryptoService } from '../common/field-crypto.service';
import { moneyIn, moneyOut } from '../common/money';
import { Paginated } from '../common/pagination';
import { SequenceService } from '../common/sequence.service';
import { PaymentOrderStatus, Prisma, RefundStatus } from '../generated/prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { CreateRefundDto, PayRefundDto, RefundQueryDto } from './payments.dto';

const refundInclude = {
  order: {
    include: {
      event: { select: { id: true, code: true, titleTh: true, organizationId: true, status: true } },
      registration: { select: { referenceNo: true, status: true } },
    },
  },
  requestedBy: { select: { id: true, displayName: true } },
  decidedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.RefundInclude;
type RefundRow = Prisma.RefundGetPayload<{ include: typeof refundInclude }>;

/** Refunds that still count against the refundable balance. */
const LIVE: RefundStatus[] = ['REQUESTED', 'APPROVED', 'PAID'];

/**
 * คืนเงิน (spec §4.7.6). REQUESTED ─approve→ APPROVED ─pay→ PAID (ledger REFUND)
 *                                   └reject→ REJECTED
 * Separation of duties: approver ≠ requester and payer ≠ requester. Partial refunds are allowed
 * up to the money actually received. The payee account number is stored AES-256-GCM encrypted;
 * revealing it is permission-checked and audited.
 */
@Injectable()
export class RefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly seq: SequenceService,
    private readonly crypto: FieldCryptoService,
  ) {}

  /** Paid orders that can still be refunded (for the "create refund" picker). */
  async refundable(eventId: string | undefined, search: string | undefined, user: AuthUser) {
    const scope = await this.access.orgScope(user, 'refund:create');
    const s = search?.trim();
    const orders = await this.prisma.paymentOrder.findMany({
      where: {
        status: { in: ['PAID', 'REFUND_PENDING', 'PARTIALLY_REFUNDED'] },
        ...(eventId ? { eventId } : {}),
        ...(scope === 'ALL' ? {} : { event: { organizationId: { in: scope } } }),
        ...(s
          ? { OR: [{ payerName: { contains: s, mode: 'insensitive' } }, { orderNo: s.toUpperCase() }, { registration: { referenceNo: s.toUpperCase() } }] }
          : {}),
      },
      include: { event: { select: { code: true, titleTh: true } }, registration: { select: { referenceNo: true, status: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 30,
    });
    const out = [];
    for (const o of orders) {
      const b = await this.balance(this.prisma, o.id);
      if (b.refundable.greaterThan(0)) {
        out.push({
          orderId: o.id,
          orderNo: o.orderNo,
          status: o.status,
          payerName: o.payerName,
          referenceNo: o.registration?.referenceNo ?? null,
          registrationStatus: o.registration?.status ?? null,
          eventCode: o.event.code,
          eventTitle: o.event.titleTh,
          paid: moneyOut(b.paid),
          refundable: moneyOut(b.refundable),
        });
      }
    }
    return out;
  }

  async create(dto: CreateRefundDto, user: AuthUser, meta: RequestMeta) {
    const order = await this.prisma.paymentOrder.findUnique({ where: { id: dto.orderId }, include: { event: true } });
    if (!order) throw Errors.notFound('ใบแจ้งชำระ');
    await this.access.assertOrg(user, 'refund:create', order.event.organizationId);
    const amount = moneyIn(dto.amount)!;
    if (!amount.greaterThan(0)) throw Errors.validation('จำนวนเงินคืนต้องมากกว่า 0');

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payment_orders WHERE id = ${order.id}::uuid FOR UPDATE`;
      const fresh = await tx.paymentOrder.findUniqueOrThrow({ where: { id: order.id } });
      if (!['PAID', 'REFUND_PENDING', 'PARTIALLY_REFUNDED'].includes(fresh.status)) throw Errors.invalidState('คืนเงินได้เฉพาะรายการที่ชำระแล้ว');
      const b = await this.balance(tx, order.id);
      if (amount.greaterThan(b.refundable)) throw Errors.validation(`จำนวนเงินคืนเกินยอดที่คืนได้ (${b.refundable.toFixed(2)} บาท)`);

      const r = await tx.refund.create({
        data: {
          refundNo: await this.seq.next(tx, 'RF'),
          orderId: order.id,
          amount,
          reason: dto.reason.trim(),
          payeeName: dto.payeeName.trim(),
          bankName: dto.bankName.trim(),
          accountNoEnc: this.crypto.encrypt(dto.accountNo.trim()),
          accountNoMasked: FieldCryptoService.mask(dto.accountNo),
          requestedById: user.id,
        },
      });
      await this.syncOrderStatus(tx, order.id);
      // Never log the account number itself.
      await this.audit.log({ actorId: user.id, action: 'refund.request', entityType: 'refund', entityId: r.id, after: { refundNo: r.refundNo, orderNo: order.orderNo, amount: amount.toFixed(2), account: r.accountNoMasked }, reason: dto.reason, meta }, tx);
      return { id: r.id, refundNo: r.refundNo };
    });
  }

  async list(q: RefundQueryDto, user: AuthUser) {
    const scope = await this.access.orgScope(user, 'refund:view');
    const where: Prisma.RefundWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(scope === 'ALL' ? {} : { order: { event: { organizationId: { in: scope } } } }),
      ...(q.search ? { OR: [{ refundNo: q.search.trim().toUpperCase() }, { payeeName: { contains: q.search.trim(), mode: 'insensitive' } }, { order: { orderNo: q.search.trim().toUpperCase() } }] } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.refund.findMany({ where, include: refundInclude, orderBy: { createdAt: q.order }, skip: q.skip, take: q.perPage }),
      this.prisma.refund.count({ where }),
    ]);
    return Paginated.of(rows.map((r) => this.dto(r)), total, q);
  }

  approve(id: string, user: AuthUser, meta: RequestMeta) {
    return this.decide(id, 'APPROVED', undefined, user, meta);
  }

  reject(id: string, reason: string, user: AuthUser, meta: RequestMeta) {
    return this.decide(id, 'REJECTED', reason, user, meta);
  }

  /** Records that the money was transferred back (bank reference) → ledger REFUND entry. */
  async pay(id: string, dto: PayRefundDto, user: AuthUser, meta: RequestMeta) {
    const r = await this.load(id, user, 'refund:refund');
    if (r.requestedById === user.id) throw Errors.forbidden('ผู้จ่ายคืนต้องไม่ใช่ผู้ขอคืนเงิน (การแบ่งแยกหน้าที่)');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payment_orders WHERE id = ${r.orderId}::uuid FOR UPDATE`;
      const res = await tx.refund.updateMany({
        where: { id, status: 'APPROVED' },
        data: { status: 'PAID', paidById: user.id, paidAt: new Date(), paidRef: dto.paidRef.trim(), version: { increment: 1 } },
      });
      if (res.count !== 1) throw Errors.invalidState('จ่ายคืนได้เฉพาะคำขอที่อนุมัติแล้ว');
      await tx.paymentLedgerEntry.create({ data: { orderId: r.orderId, entryType: 'REFUND', amount: r.amount, reason: `${r.refundNo}: ${r.reason}`, createdById: user.id } });
      const status = await this.syncOrderStatus(tx, r.orderId);
      await this.audit.log({ actorId: user.id, action: 'refund.pay', entityType: 'refund', entityId: id, before: { status: 'APPROVED' }, after: { status: 'PAID', paidRef: dto.paidRef, orderStatus: status }, meta }, tx);
      return { id, status: 'PAID', orderStatus: status };
    });
  }

  /** Full account number for the officer who transfers the money. Audited. */
  async revealAccount(id: string, user: AuthUser, meta: RequestMeta) {
    const r = await this.load(id, user, 'refund:refund');
    await this.audit.log({ actorId: user.id, action: 'refund.reveal_account', entityType: 'refund', entityId: id, meta });
    return { accountNo: this.crypto.decrypt(r.accountNoEnc), bankName: r.bankName, payeeName: r.payeeName };
  }

  // ───────────── helpers ─────────────

  private async decide(id: string, to: 'APPROVED' | 'REJECTED', reason: string | undefined, user: AuthUser, meta: RequestMeta) {
    const r = await this.load(id, user, 'refund:approve');
    if (r.requestedById === user.id) throw Errors.forbidden('ผู้อนุมัติต้องไม่ใช่ผู้ขอคืนเงิน (การแบ่งแยกหน้าที่)');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payment_orders WHERE id = ${r.orderId}::uuid FOR UPDATE`;
      const res = await tx.refund.updateMany({
        where: { id, status: 'REQUESTED' },
        data: { status: to, decidedById: user.id, decidedAt: new Date(), rejectReason: reason ?? null, version: { increment: 1 } },
      });
      if (res.count !== 1) throw Errors.invalidState('คำขอนี้ได้รับการพิจารณาแล้ว');
      const status = await this.syncOrderStatus(tx, r.orderId);
      await this.audit.log({ actorId: user.id, action: `refund.${to.toLowerCase()}`, entityType: 'refund', entityId: id, before: { status: 'REQUESTED' }, after: { status: to, orderStatus: status }, reason, meta }, tx);
      return { id, status: to };
    });
  }

  /** Money received (verified payments − reversals) and what can still be refunded. */
  private async balance(db: Tx | PrismaService, orderId: string) {
    const [ledger, refunds] = await Promise.all([
      db.paymentLedgerEntry.groupBy({ by: ['entryType'], where: { orderId }, _sum: { amount: true }, orderBy: { entryType: 'asc' } }),
      db.refund.aggregate({ where: { orderId, status: { in: LIVE } }, _sum: { amount: true } }),
    ]);
    const sum = (t: string) => ledger.find((l) => l.entryType === t)?._sum?.amount ?? new Prisma.Decimal(0);
    const paid = sum('PAYMENT').negated().minus(sum('REVERSAL'));
    const committed = refunds._sum.amount ?? new Prisma.Decimal(0);
    const refunded = sum('REFUND');
    return { paid, refunded, committed, refundable: paid.minus(committed) };
  }

  /**
   * Order status from the money: fully refunded → REFUNDED, some refunded → PARTIALLY_REFUNDED,
   * a refund in progress or a cancelled registration/event still owed money → REFUND_PENDING, else PAID.
   */
  private async syncOrderStatus(tx: Tx, orderId: string): Promise<PaymentOrderStatus> {
    const order = await tx.paymentOrder.findUniqueOrThrow({ where: { id: orderId }, include: { event: true, registration: true } });
    const b = await this.balance(tx, orderId);
    const inFlight = await tx.refund.count({ where: { orderId, status: { in: ['REQUESTED', 'APPROVED'] } } });
    const owed = order.event.status === 'CANCELLED' || (order.registration && ['CANCELLED', 'EXPIRED'].includes(order.registration.status));
    let status: PaymentOrderStatus;
    if (b.paid.greaterThan(0) && b.refunded.greaterThanOrEqualTo(b.paid)) status = 'REFUNDED';
    else if (inFlight) status = 'REFUND_PENDING';
    else if (b.refunded.greaterThan(0)) status = 'PARTIALLY_REFUNDED';
    else status = owed ? 'REFUND_PENDING' : 'PAID';
    if (status !== order.status) {
      await tx.paymentOrder.update({ where: { id: orderId }, data: { status, ...(status === 'REFUNDED' ? { closedAt: new Date() } : {}), version: { increment: 1 } } });
    }
    return status;
  }

  private async load(id: string, user: AuthUser, perm: 'refund:approve' | 'refund:refund' | 'refund:view') {
    const r = await this.prisma.refund.findUnique({ where: { id }, include: refundInclude });
    if (!r) throw Errors.notFound('คำขอคืนเงิน');
    await this.access.assertOrg(user, perm, r.order.event.organizationId);
    return r;
  }

  private dto(r: RefundRow) {
    const amount = moneyOut(r.amount)!;
    return {
      id: r.id,
      refundNo: r.refundNo,
      status: r.status,
      amount,
      amountText: bahtText(amount),
      reason: r.reason,
      payeeName: r.payeeName,
      bankName: r.bankName,
      accountNoMasked: r.accountNoMasked,
      orderId: r.orderId,
      orderNo: r.order.orderNo,
      orderStatus: r.order.status,
      referenceNo: r.order.registration?.referenceNo ?? null,
      eventCode: r.order.event.code,
      eventTitle: r.order.event.titleTh,
      requestedById: r.requestedBy.id,
      requestedByName: r.requestedBy.displayName,
      decidedByName: r.decidedBy?.displayName ?? null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      rejectReason: r.rejectReason,
      paidAt: r.paidAt?.toISOString() ?? null,
      paidRef: r.paidRef,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
