import { Injectable } from '@nestjs/common';
import { bahtText } from '@sru/shared-utils';
import type { AuthUser } from '../auth/auth.types';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import type { RequestMeta } from '../common/decorators';
import { Errors } from '../common/errors';
import { moneyIn, moneyOut } from '../common/money';
import { Paginated } from '../common/pagination';
import { SequenceService } from '../common/sequence.service';
import { CashierSessionStatus, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { paymentDueAt } from './fee';
import { CashierQueryDto, CloseSessionDto, OpenSessionDto, PayablesQueryDto, RemitDto } from './payments.dto';
import { PaymentsService } from './payments.service';

const sessionInclude = {
  event: { select: { id: true, code: true, titleTh: true, organizationId: true, startAt: true } },
  cashier: { select: { id: true, displayName: true } },
  confirmedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.CashierSessionInclude;
type SessionRow = Prisma.CashierSessionGetPayload<{ include: typeof sessionInclude }>;

/**
 * กะรับเงินหน้างาน (spec §4.7 on-site payment).
 *
 *   OPEN ─close(count)→ CLOSED ─remit(ใบนำส่งเงินสด)→ REMITTED ─confirm→ CONFIRMED
 *
 * Cash collected in a session is booked immediately (registration CONFIRMED), but the payments
 * only become eligible for a กองคลัง batch once an org finance officer — not the cashier —
 * confirms the remitted session. Voiding a cash receipt needs cashier:void by someone other than
 * the cashier who took the money (spec: ผู้อนุมัติยกเลิกรับเงิน ≠ ผู้รับเงิน), and only while the
 * session is still open (totals are frozen at close by a DB trigger).
 */
@Injectable()
export class CashierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly seq: SequenceService,
    private readonly payments: PaymentsService,
  ) {}

  async open(dto: OpenSessionDto, user: AuthUser, meta: RequestMeta) {
    const event = await this.prisma.event.findFirst({ where: { id: dto.eventId, deletedAt: null } });
    if (!event) throw Errors.notFound('กิจกรรม');
    await this.access.assertOrg(user, 'cashier:collect', event.organizationId);
    if (!event.isPaid) throw Errors.invalidState('กิจกรรมนี้ไม่มีค่าลงทะเบียน');
    if (['CANCELLED', 'COMPLETED', 'DRAFT', 'PENDING_APPROVAL', 'REJECTED'].includes(event.status)) {
      throw Errors.invalidState('ไม่สามารถเปิดกะรับเงินสำหรับกิจกรรมในสถานะนี้ได้');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const s = await tx.cashierSession.create({
          data: { sessionNo: await this.seq.next(tx, 'CS'), eventId: event.id, cashierId: user.id, openingFloat: moneyIn(dto.openingFloat ?? '0')! },
        });
        await this.audit.log({ actorId: user.id, action: 'cashier.open', entityType: 'cashier_session', entityId: s.id, after: { sessionNo: s.sessionNo, eventId: event.id, openingFloat: s.openingFloat.toFixed(2) }, meta }, tx);
        return { id: s.id, sessionNo: s.sessionNo };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw Errors.conflict('SESSION_ALREADY_OPEN', 'ท่านมีกะรับเงินที่เปิดอยู่สำหรับกิจกรรมนี้แล้ว');
      }
      throw e;
    }
  }

  /** Cashiers see their own sessions; officers with cashier:approve see sessions in their data scope. */
  async list(q: CashierQueryDto, user: AuthUser) {
    const canApprove = this.access.has(user, 'cashier:approve');
    const scope = canApprove ? await this.access.orgScope(user, 'cashier:approve') : null;
    const where: Prisma.CashierSessionWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.eventId ? { eventId: q.eventId } : {}),
      ...(scope === null ? { cashierId: user.id } : scope === 'ALL' ? {} : { OR: [{ cashierId: user.id }, { event: { organizationId: { in: scope } } }] }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.cashierSession.findMany({ where, include: sessionInclude, orderBy: { openedAt: q.order }, skip: q.skip, take: q.perPage }),
      this.prisma.cashierSession.count({ where }),
    ]);
    const totals = await this.liveTotals(rows.map((r) => r.id));
    return Paginated.of(rows.map((r) => this.dto(r, totals.get(r.id))), total, q);
  }

  async detail(id: string, user: AuthUser) {
    const s = await this.load(id, user);
    const payments = await this.prisma.payment.findMany({
      where: { cashierSessionId: id },
      include: { order: { include: { registration: { select: { referenceNo: true } } } } },
      orderBy: { submittedAt: 'asc' },
    });
    const totals = await this.liveTotals([id]);
    return {
      ...this.dto(s, totals.get(id)),
      payments: payments.map((p) => ({
        ...this.payments.paymentDto(p),
        orderNo: p.order.orderNo,
        payerName: p.order.payerName,
        referenceNo: p.order.registration?.referenceNo ?? null,
        voidReason: p.voidReason,
      })),
    };
  }

  /** Registrations of the session's event with an unpaid order (no slip awaiting review). */
  async payables(id: string, q: PayablesQueryDto, user: AuthUser) {
    const s = await this.load(id, user);
    const search = q.search?.trim();
    const orders = await this.prisma.paymentOrder.findMany({
      where: {
        eventId: s.eventId,
        status: 'UNPAID',
        ...(search
          ? {
              OR: [
                { payerName: { contains: search, mode: 'insensitive' } },
                { payerEmail: { contains: search.toLowerCase() } },
                { orderNo: search.toUpperCase() },
                { registration: { referenceNo: search.toUpperCase() } },
              ],
            }
          : {}),
      },
      include: { registration: { select: { referenceNo: true, phone: true } } },
      orderBy: { createdAt: 'asc' },
      take: 30,
    });
    return orders.map((o) => ({
      orderId: o.id,
      orderNo: o.orderNo,
      referenceNo: o.registration?.referenceNo ?? null,
      payerName: o.payerName,
      payerEmail: o.payerEmail,
      phone: o.registration?.phone ?? null,
      feeName: (o.feeSnapshot as { nameTh?: string }).nameTh ?? '',
      amount: moneyOut(o.amount)!,
      dueAt: o.dueAt.toISOString(),
    }));
  }

  /** Receive cash for one order. The amount is the order's snapshot – the cashier never types it. */
  async collect(id: string, orderId: string, user: AuthUser, meta: RequestMeta) {
    const s = await this.load(id, user);
    if (s.cashierId !== user.id) throw Errors.forbidden('รับเงินได้เฉพาะในกะของตนเอง');
    if (s.status !== 'OPEN') throw Errors.invalidState('กะรับเงินนี้ปิดแล้ว');
    const head = await this.prisma.paymentOrder.findUnique({ where: { id: orderId }, include: { registration: true } });
    if (!head || head.eventId !== s.eventId) throw Errors.notFound('ใบแจ้งชำระของกิจกรรมนี้');
    if (head.registration?.userId === user.id) throw Errors.forbidden('ไม่สามารถรับชำระเงินของตนเองได้ (การแบ่งแยกหน้าที่)');

    const payment = await this.prisma.$transaction(async (tx) => {
      // Lock order registration → session → order (same prefix as expiry / verify).
      if (head.registrationId) await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${head.registrationId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM cashier_sessions WHERE id = ${id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM payment_orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      const [session, order] = await Promise.all([
        tx.cashierSession.findUniqueOrThrow({ where: { id } }),
        tx.paymentOrder.findUniqueOrThrow({ where: { id: orderId } }),
      ]);
      if (session.status !== 'OPEN') throw Errors.invalidState('กะรับเงินนี้ปิดแล้ว');
      if (order.status === 'PENDING_VERIFICATION') throw Errors.invalidState('รายการนี้มีหลักฐานการโอนรอตรวจสอบอยู่ กรุณาให้การเงินตรวจสอบก่อน');
      if (order.status !== 'UNPAID') throw Errors.invalidState('รายการนี้ไม่อยู่ในสถานะรอชำระ');

      const now = new Date();
      const p = await tx.payment.create({
        data: {
          paymentNo: await this.seq.next(tx, 'PAY'),
          orderId,
          channel: 'ONSITE',
          amount: order.amount,
          status: 'VERIFIED',
          submittedById: user.id,
          verifiedById: user.id,
          verifiedAt: now,
          transferredAt: now,
          cashierSessionId: id,
        },
      });
      await tx.paymentLedgerEntry.create({ data: { orderId, paymentId: p.id, entryType: 'PAYMENT', amount: order.amount.negated(), reason: `รับเงินสดหน้างาน ${session.sessionNo}`, createdById: user.id } });
      await tx.paymentOrder.update({ where: { id: orderId }, data: { status: 'PAID', paidAt: now, version: { increment: 1 } } });
      if (order.registrationId) {
        await tx.registration.updateMany({
          where: { id: order.registrationId, status: 'PENDING_PAYMENT' },
          data: { status: 'CONFIRMED', confirmedAt: now, paymentDueAt: null, version: { increment: 1 } },
        });
      }
      await this.audit.log({ actorId: user.id, action: 'cashier.collect', entityType: 'payment', entityId: p.id, after: { sessionNo: session.sessionNo, orderNo: order.orderNo, amount: order.amount.toFixed(2) }, meta }, tx);
      return p;
    });
    return { ...this.payments.paymentDto(payment), orderNo: head.orderNo, payerName: head.payerName, referenceNo: head.registration?.referenceNo ?? null, amountText: bahtText(moneyOut(payment.amount)!) };
  }

  /** Void a cash receipt (wrong person / mistake). Different person from the cashier; session must be OPEN. */
  async voidPayment(paymentId: string, reason: string, user: AuthUser, meta: RequestMeta) {
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { cashierSession: true, order: { include: { event: true } } } });
    if (!p?.cashierSession) throw Errors.notFound('รายการรับเงินหน้างาน');
    await this.access.assertOrg(user, 'cashier:void', p.order.event.organizationId);
    if (p.submittedById === user.id) throw Errors.forbidden('ผู้อนุมัติยกเลิกรับเงินต้องไม่ใช่ผู้รับเงิน (การแบ่งแยกหน้าที่)');

    return this.prisma.$transaction(async (tx) => {
      if (p.order.registrationId) await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${p.order.registrationId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM cashier_sessions WHERE id = ${p.cashierSessionId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM payment_orders WHERE id = ${p.orderId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE`;
      const [session, fresh] = await Promise.all([
        tx.cashierSession.findUniqueOrThrow({ where: { id: p.cashierSessionId! } }),
        tx.payment.findUniqueOrThrow({ where: { id: paymentId } }),
      ]);
      if (session.status !== 'OPEN') throw Errors.invalidState('ยกเลิกได้เฉพาะรายการในกะที่ยังเปิดอยู่');
      if (fresh.status !== 'VERIFIED') throw Errors.invalidState('รายการนี้ถูกยกเลิกแล้ว');

      const now = new Date();
      const dueAt = paymentDueAt(now, 24, p.order.event.startAt);
      await tx.payment.update({ where: { id: paymentId }, data: { status: 'VOIDED', voidedById: user.id, voidedAt: now, voidReason: reason, version: { increment: 1 } } });
      await tx.paymentLedgerEntry.create({ data: { orderId: p.orderId, paymentId, entryType: 'REVERSAL', amount: fresh.amount, reason, createdById: user.id } });
      await tx.paymentOrder.update({ where: { id: p.orderId }, data: { status: 'UNPAID', paidAt: null, dueAt, version: { increment: 1 } } });
      if (p.order.registrationId) {
        await tx.registration.updateMany({
          where: { id: p.order.registrationId, status: 'CONFIRMED' },
          data: { status: 'PENDING_PAYMENT', confirmedAt: null, paymentDueAt: dueAt, version: { increment: 1 } },
        });
      }
      await this.audit.log({ actorId: user.id, action: 'cashier.void', entityType: 'payment', entityId: paymentId, before: { status: 'VERIFIED' }, after: { status: 'VOIDED', newDueAt: dueAt }, reason, meta }, tx);
      this.payments.scheduleExpiry({ id: p.orderId, dueAt });
      return { id: paymentId, status: 'VOIDED' };
    });
  }

  /** Cashier closes the session with the counted cash; the expected total is frozen at the same time. */
  async close(id: string, dto: CloseSessionDto, user: AuthUser, meta: RequestMeta) {
    const s = await this.load(id, user);
    if (s.cashierId !== user.id) throw Errors.forbidden('ปิดกะได้เฉพาะผู้รับเงินของกะ');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM cashier_sessions WHERE id = ${id}::uuid FOR UPDATE`;
      const agg = await tx.payment.aggregate({ where: { cashierSessionId: id, status: 'VERIFIED' }, _sum: { amount: true } });
      const expected = agg._sum.amount ?? new Prisma.Decimal(0);
      const counted = moneyIn(dto.countedAmount)!;
      const res = await tx.cashierSession.updateMany({
        where: { id, status: 'OPEN' },
        data: { status: 'CLOSED', expectedAmount: expected, countedAmount: counted, closedAt: new Date(), closeNote: dto.note || null, version: { increment: 1 } },
      });
      if (res.count !== 1) throw Errors.invalidState('กะนี้ปิดไปแล้ว');
      const diff = counted.minus(expected);
      if (!diff.isZero() && !dto.note?.trim()) throw Errors.validation('ยอดนับได้ไม่ตรงกับยอดในระบบ กรุณาระบุหมายเหตุ');
      await this.audit.log({ actorId: user.id, action: 'cashier.close', entityType: 'cashier_session', entityId: id, after: { expected: expected.toFixed(2), counted: counted.toFixed(2), difference: diff.toFixed(2) }, reason: dto.note, meta }, tx);
      return { id, status: 'CLOSED', expectedAmount: moneyOut(expected), countedAmount: moneyOut(counted), difference: moneyOut(diff) };
    });
  }

  /** Records the cash remittance document (ใบนำส่งเงิน) number. */
  async remit(id: string, dto: RemitDto, user: AuthUser, meta: RequestMeta) {
    const s = await this.load(id, user);
    if (s.cashierId !== user.id && !(await this.access.canOnOrg(user, 'cashier:approve', s.event.organizationId))) throw Errors.forbidden();
    return this.transition(id, 'CLOSED', 'REMITTED', user, meta, { remittanceNo: dto.remittanceNo.trim(), remittedAt: new Date() });
  }

  /** Org finance officer confirms the remitted cash → payments become batchable. */
  async confirm(id: string, user: AuthUser, meta: RequestMeta) {
    const s = await this.load(id, user);
    await this.access.assertOrg(user, 'cashier:approve', s.event.organizationId);
    if (s.cashierId === user.id) throw Errors.forbidden('ผู้ยืนยันยอดต้องไม่ใช่ผู้รับเงิน (การแบ่งแยกหน้าที่)');
    return this.transition(id, 'REMITTED', 'CONFIRMED', user, meta, { confirmedById: user.id, confirmedAt: new Date() });
  }

  // ───────────── helpers ─────────────

  private async transition(id: string, from: CashierSessionStatus, to: CashierSessionStatus, user: AuthUser, meta: RequestMeta, data: Prisma.CashierSessionUncheckedUpdateManyInput) {
    return this.prisma.$transaction(async (tx) => {
      const res = await tx.cashierSession.updateMany({ where: { id, status: from }, data: { ...data, status: to, version: { increment: 1 } } });
      if (res.count !== 1) throw Errors.invalidState(`กะรับเงินต้องอยู่ในสถานะ ${from}`);
      await this.audit.log({ actorId: user.id, action: `cashier.${to.toLowerCase()}`, entityType: 'cashier_session', entityId: id, before: { status: from }, after: { status: to, ...data }, meta }, tx);
      return { id, status: to };
    });
  }

  /** The cashier of the session, or anyone with cashier:view/approve over the event's organization. */
  private async load(id: string, user: AuthUser) {
    const s = await this.prisma.cashierSession.findUnique({ where: { id }, include: sessionInclude });
    if (!s) throw Errors.notFound('กะรับเงิน');
    if (s.cashierId !== user.id && !(await this.access.canOnOrg(user, 'cashier:view', s.event.organizationId))) throw Errors.notFound('กะรับเงิน');
    return s;
  }

  private async liveTotals(ids: string[]) {
    if (!ids.length) return new Map<string, { sum: Prisma.Decimal; count: number }>();
    const rows = await this.prisma.payment.groupBy({
      by: ['cashierSessionId'],
      where: { cashierSessionId: { in: ids }, status: 'VERIFIED' },
      _sum: { amount: true },
      _count: { _all: true },
      orderBy: { cashierSessionId: 'asc' },
    });
    return new Map(rows.map((r) => [r.cashierSessionId!, { sum: r._sum?.amount ?? new Prisma.Decimal(0), count: (r._count as { _all: number })._all }]));
  }

  private dto(s: SessionRow, live?: { sum: Prisma.Decimal; count: number }) {
    const collected = live?.sum ?? new Prisma.Decimal(0);
    const diff = s.countedAmount && s.expectedAmount ? s.countedAmount.minus(s.expectedAmount) : null;
    return {
      id: s.id,
      sessionNo: s.sessionNo,
      status: s.status,
      eventId: s.event.id,
      eventCode: s.event.code,
      eventTitle: s.event.titleTh,
      cashierId: s.cashier.id,
      cashierName: s.cashier.displayName,
      openingFloat: moneyOut(s.openingFloat),
      collectedAmount: moneyOut(collected),
      collectedText: bahtText(moneyOut(collected)!),
      paymentCount: live?.count ?? 0,
      expectedAmount: moneyOut(s.expectedAmount),
      countedAmount: moneyOut(s.countedAmount),
      difference: diff ? moneyOut(diff) : null,
      closeNote: s.closeNote,
      remittanceNo: s.remittanceNo,
      openedAt: s.openedAt.toISOString(),
      closedAt: s.closedAt?.toISOString() ?? null,
      remittedAt: s.remittedAt?.toISOString() ?? null,
      confirmedAt: s.confirmedAt?.toISOString() ?? null,
      confirmedByName: s.confirmedBy?.displayName ?? null,
    };
  }
}
