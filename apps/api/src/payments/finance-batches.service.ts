import { HttpStatus, Injectable, StreamableFile } from '@nestjs/common';
import type { FinanceBatchDto } from '@sru/shared-types';
import { bahtText, fiscalYearBE, formatMoney, formatReceiptNo, formatThaiDate, formatThaiDateTime, normalizeReceiptNo } from '@sru/shared-utils';
import type { AuthUser } from '../auth/auth.types';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import type { RequestMeta } from '../common/decorators';
import { AppError, Errors } from '../common/errors';
import { moneyOut } from '../common/money';
import { Paginated } from '../common/pagination';
import { SequenceService } from '../common/sequence.service';
import { SettingsService } from '../common/settings.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { billingDto, billingText } from './billing';
import { statusLabel, UNIVERSITY_NAME } from './documents/labels';
import { renderTablePdf } from './documents/pdf';
import {
  ATTENDEE_TEMPLATE_KEY,
  AttendeeColumnKey,
  BATCH_TEMPLATE_KEY,
  BatchColumnKey,
  DEFAULT_ATTENDEE_TEMPLATE,
  DEFAULT_BATCH_TEMPLATE,
  isAttendeeTemplate,
  isBatchTemplate,
} from './documents/templates';
import { renderTableXlsx } from './documents/xlsx';
import { BatchQueryDto, CreateBatchDto, RecordReceiptsDto } from './payments.dto';

const batchInclude = {
  event: { select: { id: true, code: true, titleTh: true, startAt: true } },
  organization: { select: { id: true, nameTh: true } },
  createdBy: { select: { id: true, displayName: true } },
  receivedBy: { select: { id: true, displayName: true } },
  _count: { select: { receipts: { where: { status: { not: 'VOIDED' } } } } },
} satisfies Prisma.FinanceBatchInclude;
type BatchRow = Prisma.FinanceBatchGetPayload<{ include: typeof batchInclude }>;

const itemInclude = {
  payment: {
    include: {
      order: { include: { registration: { select: { referenceNo: true } }, group: { select: { groupNo: true } }, _count: { select: { lines: true } } } },
      verifiedBy: { select: { displayName: true } },
      receipts: { where: { status: { not: 'VOIDED' } } },
    },
  },
} satisfies Prisma.FinanceBatchItemInclude;

/**
 * ชุดนำส่งกองคลัง (spec §4.7). Lifecycle:
 *   DRAFT ─submit→ SUBMITTED ─receive→ RECEIVED ─(all receipt numbers recorded)→ RECEIPTS_ISSUED
 *                           └return→ RETURNED (items released, organizer prepares a new batch)
 * Separation of duties: the กองคลัง officer who receives must not be the preparer/submitter.
 * Items and totals are frozen at creation (DB trigger), the report snapshot at submission.
 */
@Injectable()
export class FinanceBatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly seq: SequenceService,
    private readonly settings: SettingsService,
  ) {}

  /** Verified payments of an event that are not yet in a live batch. */
  async eligible(eventId: string, user: AuthUser) {
    const event = await this.event(eventId);
    await this.access.assertOrg(user, 'finance_batch:create', event.organizationId);
    const rows = await this.eligibleWhere(this.prisma, eventId);
    const total = rows.reduce((a, p) => a.plus(p.amount), new Prisma.Decimal(0));
    return {
      event: { id: event.id, code: event.code, titleTh: event.titleTh },
      count: rows.length,
      totalAmount: moneyOut(total),
      payments: rows.map((p) => ({
        id: p.id,
        paymentNo: p.paymentNo,
        orderNo: p.order.orderNo,
        payerName: p.order.payerName,
        amount: moneyOut(p.amount),
        verifiedAt: p.verifiedAt?.toISOString() ?? null,
      })),
    };
  }

  private eligibleWhere(db: Tx | PrismaService, eventId: string) {
    return db.payment.findMany({
      where: {
        status: 'VERIFIED',
        order: { eventId },
        batchItems: { none: { isActive: true } },
        // Cash is batchable only after an officer has confirmed the remitted cashier session.
        OR: [{ channel: 'TRANSFER' }, { cashierSession: { status: 'CONFIRMED' } }],
      },
      include: { order: true },
      orderBy: { verifiedAt: 'asc' },
    });
  }

  async create(dto: CreateBatchDto, user: AuthUser, meta: RequestMeta) {
    const event = await this.event(dto.eventId);
    await this.access.assertOrg(user, 'finance_batch:create', event.organizationId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Serialise batch creation per event so two officers cannot grab the same payments.
        await tx.$queryRaw`SELECT id FROM events WHERE id = ${event.id}::uuid FOR UPDATE`;
        let payments = await this.eligibleWhere(tx, event.id);
        if (dto.paymentIds) {
          const wanted = new Set(dto.paymentIds);
          payments = payments.filter((p) => wanted.has(p.id));
          if (payments.length !== wanted.size) {
            throw Errors.validation('มีรายการที่ยังไม่ผ่านการตรวจสอบ ไม่ใช่ของกิจกรรมนี้ หรืออยู่ในชุดนำส่งอื่นแล้ว');
          }
        }
        if (!payments.length) throw Errors.invalidState('ไม่มีรายการชำระเงินที่ตรวจสอบแล้วและยังไม่ได้นำส่ง');
        const total = payments.reduce((a, p) => a.plus(p.amount), new Prisma.Decimal(0));
        const batch = await tx.financeBatch.create({
          data: {
            batchNo: await this.seq.next(tx, 'FB'),
            organizationId: event.organizationId,
            eventId: event.id,
            totalAmount: total,
            itemCount: payments.length,
            note: dto.note || null,
            createdById: user.id,
            items: { create: payments.map((p) => ({ paymentId: p.id, amount: p.amount })) },
          },
        });
        await this.audit.log(
          { actorId: user.id, action: 'finance_batch.create', entityType: 'finance_batch', entityId: batch.id, after: { batchNo: batch.batchNo, total: total.toFixed(2), items: payments.length }, meta },
          tx,
        );
        return { id: batch.id, batchNo: batch.batchNo };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw Errors.conflict('PAYMENT_ALREADY_BATCHED', 'มีรายการที่อยู่ในชุดนำส่งอื่นแล้ว');
      }
      throw e;
    }
  }

  async list(q: BatchQueryDto, user: AuthUser) {
    const scope = await this.access.orgScope(user, 'finance_batch:view');
    const where: Prisma.FinanceBatchWhereInput = {
      ...(scope === 'ALL' ? {} : { organizationId: { in: scope } }),
      ...(q.status ? { status: q.status } : {}),
      ...(q.eventId ? { eventId: q.eventId } : {}),
      ...(q.search
        ? { OR: [{ batchNo: q.search.trim().toUpperCase() }, { event: { titleTh: { contains: q.search, mode: 'insensitive' } } }, { event: { code: q.search.trim().toUpperCase() } }] }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.financeBatch.findMany({ where, include: batchInclude, orderBy: { createdAt: q.order }, skip: q.skip, take: q.perPage }),
      this.prisma.financeBatch.count({ where }),
    ]);
    return Paginated.of(rows.map((b) => this.dto(b)), total, q);
  }

  async detail(id: string, user: AuthUser) {
    const b = await this.load(id, user, 'finance_batch:view');
    const items = await this.prisma.financeBatchItem.findMany({ where: { batchId: id }, include: itemInclude, orderBy: { createdAt: 'asc' } });
    return {
      ...this.dto(b),
      items: items.map((i) => ({
        id: i.id,
        isActive: i.isActive,
        paymentId: i.paymentId,
        paymentNo: i.payment.paymentNo,
        /** FIN-10: set for a group's single combined payment (one receipt + attendee list). */
        groupNo: i.payment.order.group?.groupNo ?? null,
        memberCount: i.payment.order.group ? i.payment.order._count.lines : null,
        orderNo: i.payment.order.orderNo,
        referenceNo: i.payment.order.registration?.referenceNo ?? null,
        payerName: i.payment.order.payerName,
        amount: moneyOut(i.amount),
        transferredAt: i.payment.transferredAt?.toISOString() ?? null,
        verifiedAt: i.payment.verifiedAt?.toISOString() ?? null,
        verifiedByName: i.payment.verifiedBy?.displayName ?? null,
        receipt: i.payment.receipts[0]
          ? { id: i.payment.receipts[0].id, receiptNo: formatReceiptNo(i.payment.receipts[0].fiscalYear, i.payment.receipts[0].receiptNo), issuedAt: i.payment.receipts[0].issuedAt.toISOString().slice(0, 10) }
          : null,
        channel: i.payment.channel,
        billing: billingDto(i.payment.order),
      })),
    };
  }

  async submit(id: string, user: AuthUser, meta: RequestMeta) {
    const b = await this.load(id, user, 'finance_batch:submit');
    const snapshot = await this.detail(id, user);
    return this.transition(b.id, 'DRAFT', 'SUBMITTED', user, meta, {
      submittedById: user.id,
      submittedAt: new Date(),
      // Frozen copy of exactly what was handed to กองคลัง.
      snapshot: JSON.parse(JSON.stringify({ ...snapshot, generatedAt: new Date().toISOString() })) as Prisma.InputJsonValue,
    });
  }

  async receive(id: string, user: AuthUser, meta: RequestMeta) {
    const b = await this.load(id, user, 'finance_batch:receive');
    this.assertNotPreparer(b, user);
    return this.transition(b.id, 'SUBMITTED', 'RECEIVED', user, meta, { receivedById: user.id, receivedAt: new Date() });
  }

  /** กองคลัง returns the batch for correction; its payments become eligible for a new batch. */
  async returnBatch(id: string, reason: string, user: AuthUser, meta: RequestMeta) {
    const b = await this.load(id, user, 'finance_batch:receive');
    this.assertNotPreparer(b, user);
    return this.transition(b.id, 'SUBMITTED', 'RETURNED', user, meta, { returnedById: user.id, returnedAt: new Date(), returnReason: reason }, reason, async (tx) => {
      await tx.financeBatchItem.updateMany({ where: { batchId: b.id }, data: { isActive: false } });
    });
  }

  /** Records official receipt numbers issued by กองคลัง: "<ปีงบ>/<เลขที่>" unique per fiscal year (FIN-2). */
  async recordReceipts(id: string, dto: RecordReceiptsDto, user: AuthUser, meta: RequestMeta) {
    const b = await this.load(id, user, 'receipt:create');
    if (b.status !== 'RECEIVED') throw Errors.invalidState('บันทึกเลขที่ใบเสร็จได้เมื่อกองคลังรับชุดนำส่งแล้วเท่านั้น');
    const seen = new Set<string>();
    for (const r of dto.receipts) {
      if (seen.has(r.paymentId)) throw Errors.validation('มีรายการซ้ำในคำขอ');
      seen.add(r.paymentId);
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM finance_batches WHERE id = ${b.id}::uuid FOR UPDATE`;
        const items = await tx.financeBatchItem.findMany({ where: { batchId: b.id, isActive: true }, include: { payment: { include: { receipts: { where: { status: { not: 'VOIDED' } } } } } } });
        const byPayment = new Map(items.map((i) => [i.paymentId, i]));
        for (const r of dto.receipts) {
          const item = byPayment.get(r.paymentId);
          if (!item) throw Errors.validation(`รายการ ${r.paymentId} ไม่อยู่ในชุดนำส่งนี้`);
          if (item.payment.receipts.length) throw Errors.conflict('RECEIPT_EXISTS', `รายการ ${item.payment.paymentNo} มีเลขที่ใบเสร็จแล้ว`);
          const issuedAt = new Date(r.issuedAt);
          await tx.receiptRecord.create({
            data: {
              paymentId: r.paymentId,
              batchId: b.id,
              fiscalYear: fiscalYearBE(issuedAt),
              receiptNo: normalizeReceiptNo(r.receiptNo)!,
              issuedAt,
              amount: item.amount,
              recordedById: user.id,
            },
          });
        }
        const recorded = await tx.receiptRecord.count({ where: { batchId: b.id, status: { not: 'VOIDED' } } });
        const complete = recorded >= items.length;
        if (complete) {
          await tx.financeBatch.update({ where: { id: b.id }, data: { status: 'RECEIPTS_ISSUED', version: { increment: 1 } } });
        }
        await this.audit.log(
          { actorId: user.id, action: 'receipt.record', entityType: 'finance_batch', entityId: b.id, after: { receipts: dto.receipts.map((r) => formatReceiptNo(fiscalYearBE(new Date(r.issuedAt)), normalizeReceiptNo(r.receiptNo)!)), complete }, meta },
          tx,
        );
        return { recorded: dto.receipts.length, complete };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new AppError('RECEIPT_NO_TAKEN', 'เลขที่ใบเสร็จนี้ (ปีงบประมาณ/เลขที่) ถูกใช้แล้ว', HttpStatus.CONFLICT);
      }
      throw e;
    }
  }

  /**
   * รายงานนำส่งเงิน (FIN-1) as PDF or Excel. Both render the configurable template in
   * system_settings `finance.remittanceReportTemplate`; a DRAFT batch is watermarked "ฉบับร่าง".
   */
  async export(id: string, format: 'pdf' | 'xlsx', user: AuthUser, meta: RequestMeta) {
    const b = await this.load(id, user, 'finance_batch:export');
    const d = await this.detail(id, user);
    const items = d.items.filter((i) => i.isActive || b.status === 'RETURNED');
    const template = await this.settings.get(BATCH_TEMPLATE_KEY, DEFAULT_BATCH_TEMPLATE, isBatchTemplate);
    const event = await this.prisma.event.findUniqueOrThrow({ where: { id: b.eventId }, include: { bankAccount: true, incomeCode: true } });
    const vars = {
      universityName: UNIVERSITY_NAME,
      organizationName: b.organization.nameTh,
      batchNo: b.batchNo,
      status: b.status,
      statusLabel: statusLabel(b.status, 'batch'),
      fiscalYear: fiscalYearBE(b.createdAt),
      eventCode: b.event.code,
      eventTitle: b.event.titleTh,
      eventDate: formatThaiDate(b.event.startAt, 'long'),
      bankAccount: event.bankAccount ? `${event.bankAccount.bankName} ${event.bankAccount.accountNo} (${event.bankAccount.accountName})` : null,
      incomeCode: event.incomeCode ? `${event.incomeCode.code} ${event.incomeCode.nameTh}` : null,
      createdBy: b.createdBy.displayName,
      createdAt: formatThaiDateTime(b.createdAt),
      submittedAt: b.submittedAt ? formatThaiDateTime(b.submittedAt) : null,
      receivedBy: b.receivedBy?.displayName ?? null,
      receivedAt: b.receivedAt ? formatThaiDateTime(b.receivedAt) : null,
      itemCount: items.length,
      total: formatMoney(d.totalAmount),
      totalText: d.totalAmountText,
      note: b.note,
      printedAt: formatThaiDateTime(new Date()),
    };
    const cells = (i: (typeof items)[number], idx: number): Record<BatchColumnKey, string> => ({
      seq: String(idx + 1),
      paymentNo: i.paymentNo,
      orderNo: i.orderNo,
      referenceNo: i.referenceNo ?? '',
      payerName: i.payerName,
      billing: billingText(i.billing),
      channel: i.channel === 'ONSITE' ? 'เงินสด' : 'โอน',
      transferredAt: i.transferredAt ? formatThaiDateTime(i.transferredAt) : '',
      verifiedAt: i.verifiedAt ? formatThaiDateTime(i.verifiedAt) : '',
      incomeCode: event.incomeCode?.code ?? '',
      amount: formatMoney(i.amount ?? '0'),
      receipt: i.receipt?.receiptNo ?? '',
    });

    const body =
      format === 'pdf'
        ? await renderTablePdf({
            template,
            vars,
            rows: items.map(cells),
            total: formatMoney(d.totalAmount),
            watermark: b.status === 'DRAFT' ? 'ฉบับร่าง' : b.status === 'RETURNED' ? 'ส่งกลับแก้ไข' : undefined,
            title: `รายงานนำส่ง ${b.batchNo}`,
          })
        : await renderTableXlsx({
            template,
            vars,
            rows: items.map((i, idx) => ({ ...cells(i, idx), amount: Number(i.amount) })),
            total: Number(d.totalAmount),
            sheetName: 'รายงานนำส่ง',
          });
    await this.audit.log({ actorId: user.id, action: 'finance_batch.export', entityType: 'finance_batch', entityId: id, after: { format }, meta });
    return new StreamableFile(body, {
      type: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${b.batchNo}.${format}"`,
    });
  }

  /**
   * FIN-10: list of the people covered by a group's single receipt (issued in the organization's
   * name), to attach to the receipt. Rendered from `finance.groupReceiptAttachmentTemplate`.
   */
  async groupAttendees(id: string, paymentId: string, format: 'pdf' | 'xlsx', user: AuthUser, meta: RequestMeta) {
    const b = await this.load(id, user, 'finance_batch:export');
    const item = await this.prisma.financeBatchItem.findFirst({
      where: { batchId: id, paymentId },
      include: {
        payment: {
          include: {
            receipts: { where: { status: { not: 'VOIDED' } } },
            order: {
              include: {
                group: { select: { groupNo: true, participantOrganization: { select: { nameTh: true } } } },
                lines: {
                  include: { registration: { select: { referenceNo: true, prefix: true, firstName: true, lastName: true, status: true, participantType: { select: { nameTh: true } } } } },
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
          },
        },
      },
    });
    if (!item) throw Errors.notFound('รายการในชุดนำส่ง');
    const o = item.payment.order;
    if (!o.groupId || !o.group) throw Errors.validation('รายชื่อแนบใบเสร็จใช้กับการชำระแบบกลุ่มเท่านั้น');
    const receipt = item.payment.receipts[0];
    const template = await this.settings.get(ATTENDEE_TEMPLATE_KEY, DEFAULT_ATTENDEE_TEMPLATE, isAttendeeTemplate);
    const total = o.lines.reduce((s, l) => s.plus(l.amount), new Prisma.Decimal(0));
    const vars = {
      universityName: UNIVERSITY_NAME,
      receiptNo: receipt ? formatReceiptNo(receipt.fiscalYear, receipt.receiptNo) : '(ยังไม่ออกเลขที่)',
      receiptDate: receipt ? formatThaiDate(receipt.issuedAt, 'long') : '-',
      billingName: o.billingName ?? o.payerName,
      billingTaxId: billingText(billingDto(o)) ? `เลขผู้เสียภาษี ${o.billingTaxId ?? ''}` : '',
      organizationName: o.group.participantOrganization.nameTh,
      groupNo: o.group.groupNo,
      orderNo: o.orderNo,
      eventCode: b.event.code,
      eventTitle: b.event.titleTh,
      eventDate: formatThaiDate(b.event.startAt, 'long'),
      itemCount: o.lines.length,
      total: formatMoney(total.toFixed(2)),
      totalText: bahtText(total.toFixed(2)),
      printedAt: formatThaiDateTime(new Date()),
    };
    const statusTh = (s: string) => (s === 'CANCELLED' ? 'ยกเลิก' : s === 'CONFIRMED' ? 'ยืนยันแล้ว' : s);
    const cells = (l: (typeof o.lines)[number], idx: number): Record<AttendeeColumnKey, string> => ({
      seq: String(idx + 1),
      referenceNo: l.registration.referenceNo,
      name: [l.registration.prefix, l.registration.firstName, l.registration.lastName].filter(Boolean).join(' '),
      participantType: l.registration.participantType.nameTh,
      feeName: l.feeName,
      status: statusTh(l.registration.status),
      amount: formatMoney(l.amount.toFixed(2)),
    });
    const body =
      format === 'pdf'
        ? await renderTablePdf({ template, vars, rows: o.lines.map(cells), total: vars.total, watermark: receipt ? undefined : 'ฉบับร่าง', title: `รายชื่อแนบใบเสร็จ ${o.group.groupNo}` })
        : await renderTableXlsx({ template, vars, rows: o.lines.map((l, idx) => ({ ...cells(l, idx), amount: Number(l.amount) })), total: Number(total), sheetName: 'รายชื่อแนบใบเสร็จ' });
    await this.audit.log({ actorId: user.id, action: 'finance_batch.export_attendees', entityType: 'finance_batch', entityId: id, after: { paymentId, groupNo: o.group.groupNo, format }, meta });
    return new StreamableFile(body, {
      type: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${o.group.groupNo}-attendees.${format}"`,
    });
  }

  /**
   * Voids a recorded receipt number (wrong number / cancelled receipt per กองคลัง rules, FIN-8).
   * The batch drops back to RECEIVED so a replacement number can be recorded. The record stays
   * (status VOIDED + reason) – receipt numbers are never deleted.
   */
  async voidReceipt(receiptId: string, reason: string, user: AuthUser, meta: RequestMeta) {
    const r = await this.prisma.receiptRecord.findUnique({ where: { id: receiptId }, include: { batch: true, payment: { include: { order: { include: { event: true } } } } } });
    if (!r) throw Errors.notFound('ใบเสร็จ');
    await this.access.assertOrg(user, 'receipt:void', r.batch?.organizationId ?? r.payment.order.event.organizationId);
    return this.prisma.$transaction(async (tx) => {
      if (r.batchId) await tx.$queryRaw`SELECT id FROM finance_batches WHERE id = ${r.batchId}::uuid FOR UPDATE`;
      const res = await tx.receiptRecord.updateMany({
        where: { id: receiptId, status: { in: ['ISSUED', 'DELIVERED'] } },
        data: { status: 'VOIDED', voidedAt: new Date(), voidReason: reason },
      });
      if (res.count !== 1) throw Errors.invalidState('ใบเสร็จนี้ถูกยกเลิกแล้ว');
      if (r.batchId) {
        await tx.financeBatch.updateMany({ where: { id: r.batchId, status: 'RECEIPTS_ISSUED' }, data: { status: 'RECEIVED', version: { increment: 1 } } });
      }
      await this.audit.log({ actorId: user.id, action: 'receipt.void', entityType: 'receipt', entityId: receiptId, before: { receipt: formatReceiptNo(r.fiscalYear, r.receiptNo) }, after: { status: 'VOIDED' }, reason, meta }, tx);
      return { id: receiptId, status: 'VOIDED' };
    });
  }

  // ───────────── helpers ─────────────

  private async event(id: string) {
    const e = await this.prisma.event.findFirst({ where: { id, deletedAt: null } });
    if (!e) throw Errors.notFound('กิจกรรม');
    return e;
  }

  private async load(id: string, user: AuthUser, perm: 'finance_batch:view' | 'finance_batch:submit' | 'finance_batch:receive' | 'finance_batch:export' | 'receipt:create') {
    const b = await this.prisma.financeBatch.findUnique({ where: { id }, include: batchInclude });
    if (!b) throw Errors.notFound('ชุดนำส่ง');
    await this.access.assertOrg(user, perm, b.organizationId);
    return b;
  }

  private assertNotPreparer(b: { createdById: string; submittedById: string | null }, user: AuthUser) {
    if (b.createdById === user.id || b.submittedById === user.id) {
      throw Errors.forbidden('ผู้รับชุดนำส่งต้องไม่ใช่ผู้จัดทำหรือผู้ส่ง (การแบ่งแยกหน้าที่)');
    }
  }

  private async transition(
    id: string,
    from: BatchRow['status'],
    to: BatchRow['status'],
    user: AuthUser,
    meta: RequestMeta,
    data: Prisma.FinanceBatchUncheckedUpdateManyInput,
    reason?: string,
    extra?: (tx: Tx) => Promise<void>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const res = await tx.financeBatch.updateMany({ where: { id, status: from }, data: { ...data, status: to, version: { increment: 1 } } });
      if (res.count !== 1) throw Errors.invalidState(`ชุดนำส่งต้องอยู่ในสถานะ ${from}`);
      if (extra) await extra(tx);
      await this.audit.log({ actorId: user.id, action: `finance_batch.${to.toLowerCase()}`, entityType: 'finance_batch', entityId: id, before: { status: from }, after: { status: to }, reason, meta }, tx);
      return { id, status: to };
    });
  }

  private dto(b: BatchRow): FinanceBatchDto {
    const total = moneyOut(b.totalAmount)!;
    return {
      id: b.id,
      batchNo: b.batchNo,
      status: b.status,
      eventId: b.event.id,
      eventCode: b.event.code,
      eventTitle: b.event.titleTh,
      organizationId: b.organization.id,
      organizationName: b.organization.nameTh,
      totalAmount: total,
      totalAmountText: bahtText(total),
      itemCount: b.itemCount,
      receiptCount: b._count.receipts,
      note: b.note,
      createdByName: b.createdBy.displayName,
      createdAt: b.createdAt.toISOString(),
      submittedAt: b.submittedAt?.toISOString() ?? null,
      receivedAt: b.receivedAt?.toISOString() ?? null,
      receivedByName: b.receivedBy?.displayName ?? null,
      returnedAt: b.returnedAt?.toISOString() ?? null,
      returnReason: b.returnReason,
    };
  }
}
