import { HttpStatus, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import type { AuthUser } from '../../auth/auth.types';
import { AccessService } from '../../common/access.service';
import { AuditService } from '../../common/audit.service';
import type { RequestMeta } from '../../common/decorators';
import { AppError, Errors } from '../../common/errors';
import { moneyOut } from '../../common/money';
import { Paginated } from '../../common/pagination';
import { SequenceService } from '../../common/sequence.service';
import { registerSettingValidator, SettingsService } from '../../common/settings.service';
import { BankAccount, Prisma } from '../../generated/prisma/client';
import { PrismaService, Tx } from '../../prisma/prisma.service';
import { Cell, decodeText, DEFAULT_STATEMENT_COLUMNS, isStatementColumns, parseCsv, parseStatementRows, planAutoMatches } from './statement-parser';
import { ReconLineQueryDto, ReconReportQueryDto } from './reconciliation.dto';

export const STATEMENT_COLUMNS_KEY = 'finance.statementColumns';
export const TOLERANCE_KEY = 'finance.reconcileToleranceMinutes';
const MAX_FILE_BYTES = 5_000_000;
const MAX_LINES = 20_000;

registerSettingValidator(STATEMENT_COLUMNS_KEY, (v) => (isStatementColumns(v) ? null : 'ต้องมีคีย์ date, time, credit, debit, amount, description, reference เป็นรายการชื่อหัวคอลัมน์'));
registerSettingValidator(TOLERANCE_KEY, (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 1440 ? null : 'ต้องเป็นจำนวนนาที 1–1440'));

/** Payments that can back a statement line: transfers awaiting or past verification. */
const MATCHABLE = { channel: 'TRANSFER', status: { in: ['SUBMITTED', 'VERIFIED'] } } satisfies Prisma.PaymentWhereInput;
const LIVE_MATCH = { in: ['AUTO', 'MANUAL'] } satisfies Prisma.EnumStatementMatchStatusFilter;

const lineInclude = {
  payment: {
    select: {
      id: true,
      paymentNo: true,
      status: true,
      amount: true,
      transferredAt: true,
      submittedAt: true,
      order: { select: { orderNo: true, payerName: true, event: { select: { code: true, titleTh: true } } } },
    },
  },
  matchedBy: { select: { displayName: true } },
  statement: { select: { statementNo: true } },
} satisfies Prisma.BankStatementLineInclude;
type LineRow = Prisma.BankStatementLineGetPayload<{ include: typeof lineInclude }>;

/**
 * กระทบยอดกับ statement ธนาคาร (spec §4.7): money that reached the receiving account vs. payments
 * recorded in the system.
 *
 * - Statements are uploaded per receiving account (CSV/XLSX); only credit lines are imported and a
 *   bank transaction already imported from an overlapping file is skipped (fingerprint).
 * - Auto-matching pairs a line with a transfer payment of the same amount and a close transfer time
 *   (tolerance in `finance.reconcileToleranceMinutes`); ties are left for an officer.
 * - Officers match / unmatch / ignore lines by hand (reason required to unmatch or ignore).
 * - The report lists credits with no payment and verified transfers not found in the statement.
 *
 * Data scope: the account's organization (finance_batch:reconcile); a central account (no
 * organization) needs university-wide scope. All changes for one account are serialised by locking
 * the bank_accounts row, so an auto-match run and a manual match can never claim the same payment.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly seq: SequenceService,
    private readonly settings: SettingsService,
  ) {}

  /** Receiving accounts the user may reconcile, with the open workload. */
  async accounts(user: AuthUser) {
    const scope = await this.access.orgScope(user, 'finance_batch:reconcile');
    const accounts = await this.prisma.bankAccount.findMany({
      where: scope === 'ALL' ? {} : { organizationId: { in: scope } },
      include: { organization: { select: { nameTh: true } } },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    });
    const counts = await this.prisma.bankStatementLine.groupBy({
      by: ['bankAccountId', 'matchStatus'],
      where: { bankAccountId: { in: accounts.map((a) => a.id) } },
      _count: { _all: true },
      orderBy: { bankAccountId: 'asc' },
    });
    const last = await this.prisma.bankStatement.groupBy({ by: ['bankAccountId'], _max: { periodTo: true }, orderBy: { bankAccountId: 'asc' } });
    return accounts.map((a) => {
      const c = (s: string) => (counts.find((x) => x.bankAccountId === a.id && x.matchStatus === s)?._count as { _all: number } | undefined)?._all ?? 0;
      return {
        id: a.id,
        bankName: a.bankName,
        accountNo: a.accountNo,
        accountName: a.accountName,
        organizationName: a.organization?.nameTh ?? 'ส่วนกลาง',
        isActive: a.isActive,
        unmatched: c('UNMATCHED'),
        matched: c('AUTO') + c('MANUAL'),
        ignored: c('IGNORED'),
        coveredUntil: last.find((l) => l.bankAccountId === a.id)?._max.periodTo?.toISOString() ?? null,
      };
    });
  }

  async statements(bankAccountId: string, user: AuthUser) {
    await this.account(bankAccountId, user);
    const rows = await this.prisma.bankStatement.findMany({
      where: { bankAccountId },
      include: { uploadedBy: { select: { displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((s) => ({
      id: s.id,
      statementNo: s.statementNo,
      fileName: s.fileName,
      periodFrom: s.periodFrom.toISOString(),
      periodTo: s.periodTo.toISOString(),
      lineCount: s.lineCount,
      duplicateCount: s.duplicateCount,
      totalCredit: moneyOut(s.totalCredit),
      uploadedByName: s.uploadedBy.displayName,
      createdAt: s.createdAt.toISOString(),
    }));
  }

  /** Parses and imports a statement file, then runs auto-matching for the account. */
  async upload(bankAccountId: string, file: { buffer: Buffer; originalname: string } | undefined, user: AuthUser, meta: RequestMeta) {
    const account = await this.account(bankAccountId, user);
    if (!file?.buffer?.length) throw new AppError('FILE_REQUIRED', 'กรุณาแนบไฟล์ statement', HttpStatus.BAD_REQUEST);
    if (file.buffer.length > MAX_FILE_BYTES) throw new AppError('FILE_TOO_LARGE', 'ไฟล์มีขนาดเกิน 5 MB', HttpStatus.PAYLOAD_TOO_LARGE);

    const rows = await this.readRows(file.buffer);
    const cols = await this.settings.get(STATEMENT_COLUMNS_KEY, DEFAULT_STATEMENT_COLUMNS, isStatementColumns);
    const parsed = parseStatementRows(rows, cols);
    if (parsed.errors.length) {
      throw Errors.validation(`อ่านไฟล์ไม่ได้ ${parsed.errors.length} แถว — ไม่ได้นำเข้าข้อมูลใด ๆ`, parsed.errors.slice(0, 20));
    }
    if (!parsed.lines.length) throw Errors.validation('ไม่พบรายการเงินเข้าในไฟล์');
    if (parsed.lines.length > MAX_LINES) throw Errors.validation(`ไฟล์มีรายการเกิน ${MAX_LINES} รายการ กรุณาแบ่งไฟล์`);

    const fileSha256 = createHash('sha256').update(file.buffer).digest('hex');
    // Identical bank transactions inside one file are distinguished by their occurrence number.
    const seen = new Map<string, number>();
    const lines = parsed.lines.map((l) => {
      const key = [l.txnAt.toISOString(), l.amount, l.reference ?? '', (l.description ?? '').toLowerCase()].join('|');
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      return { ...l, fingerprint: createHash('sha256').update(`${key}|${n}`).digest('hex') };
    });

    const imported = await this.prisma.$transaction(
      async (tx) => {
        await this.lockAccount(tx, account.id);
        if (await tx.bankStatement.findUnique({ where: { bankAccountId_fileSha256: { bankAccountId: account.id, fileSha256 } } })) {
          throw Errors.conflict('STATEMENT_DUPLICATE', 'ไฟล์นี้ถูกนำเข้าแล้ว');
        }
        const existing = new Set(
          (await tx.bankStatementLine.findMany({ where: { bankAccountId: account.id, fingerprint: { in: lines.map((l) => l.fingerprint) } }, select: { fingerprint: true } })).map((r) => r.fingerprint),
        );
        const fresh = lines.filter((l) => !existing.has(l.fingerprint));
        const total = fresh.reduce((a, l) => a.plus(l.amount), new Prisma.Decimal(0));
        const times = lines.map((l) => l.txnAt.getTime());
        const statement = await tx.bankStatement.create({
          data: {
            statementNo: await this.seq.next(tx, 'BS'),
            bankAccountId: account.id,
            fileName: (file.originalname || 'statement').slice(0, 300),
            fileSha256,
            periodFrom: new Date(Math.min(...times)),
            periodTo: new Date(Math.max(...times)),
            lineCount: fresh.length,
            duplicateCount: lines.length - fresh.length,
            totalCredit: total,
            uploadedById: user.id,
          },
        });
        if (fresh.length) {
          await tx.bankStatementLine.createMany({
            data: fresh.map((l) => ({
              statementId: statement.id,
              bankAccountId: account.id,
              lineNo: l.row,
              txnAt: l.txnAt,
              amount: new Prisma.Decimal(l.amount),
              description: l.description,
              reference: l.reference,
              fingerprint: l.fingerprint,
            })),
          });
        }
        await this.audit.log(
          { actorId: user.id, action: 'reconcile.upload', entityType: 'bank_statement', entityId: statement.id, after: { statementNo: statement.statementNo, imported: fresh.length, duplicates: lines.length - fresh.length, total: total.toFixed(2) }, meta },
          tx,
        );
        return { id: statement.id, statementNo: statement.statementNo, imported: fresh.length, duplicates: lines.length - fresh.length, totalCredit: moneyOut(total) };
      },
      { timeout: 30_000 },
    );
    const auto = await this.autoMatch(account.id, user, meta);
    return { ...imported, skippedDebit: parsed.skippedDebit, autoMatched: auto.matched };
  }

  /** Re-runs auto-matching for every unmatched line of the account (e.g. after more slips were verified). */
  async autoMatch(bankAccountId: string, user: AuthUser, meta: RequestMeta) {
    const account = await this.account(bankAccountId, user);
    const toleranceMin = await this.settings.get(TOLERANCE_KEY, 15, (v): v is number => typeof v === 'number' && v >= 1 && v <= 1440);
    return this.prisma.$transaction(
      async (tx) => {
        await this.lockAccount(tx, account.id);
        const lines = await tx.bankStatementLine.findMany({ where: { bankAccountId: account.id, matchStatus: 'UNMATCHED' }, select: { id: true, txnAt: true, amount: true } });
        if (!lines.length) return { matched: 0 };
        const times = lines.map((l) => l.txnAt.getTime());
        const from = new Date(Math.min(...times) - 2 * 86400_000);
        const to = new Date(Math.max(...times) + 2 * 86400_000);
        const payments = await tx.payment.findMany({
          where: {
            ...MATCHABLE,
            ...this.accountPayments(account),
            statementLines: { none: { matchStatus: LIVE_MATCH } },
            OR: [{ transferredAt: { gte: from, lte: to } }, { transferredAt: null, submittedAt: { gte: from, lte: to } }],
          },
          select: { id: true, amount: true, transferredAt: true, submittedAt: true },
        });
        const plan = planAutoMatches(
          lines.map((l) => ({ id: l.id, txnAt: l.txnAt, amount: l.amount.toFixed(2) })),
          payments.map((p) => ({ id: p.id, amount: p.amount.toFixed(2), transferredAt: p.transferredAt, submittedAt: p.submittedAt })),
          toleranceMin * 60_000,
        );
        const now = new Date();
        for (const m of plan) {
          await tx.bankStatementLine.updateMany({
            where: { id: m.lineId, matchStatus: 'UNMATCHED' },
            data: { matchStatus: 'AUTO', paymentId: m.paymentId, matchedAt: now, matchedById: null, version: { increment: 1 } },
          });
        }
        if (plan.length) {
          await this.audit.log({ actorId: user.id, action: 'reconcile.auto_match', entityType: 'bank_account', entityId: account.id, after: { matched: plan.length, toleranceMin }, meta }, tx);
        }
        return { matched: plan.length };
      },
      { timeout: 30_000 },
    );
  }

  async lines(q: ReconLineQueryDto, user: AuthUser) {
    await this.account(q.bankAccountId, user);
    const search = q.search?.trim();
    const where: Prisma.BankStatementLineWhereInput = {
      bankAccountId: q.bankAccountId,
      ...(q.status === 'MATCHED' ? { matchStatus: LIVE_MATCH } : q.status ? { matchStatus: q.status } : {}),
      ...(q.statementId ? { statementId: q.statementId } : {}),
      ...(q.from || q.to ? { txnAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(search
        ? {
            OR: [
              { reference: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
              { payment: { paymentNo: search.toUpperCase() } },
              ...(/^\d+(\.\d{1,2})?$/.test(search) ? [{ amount: new Prisma.Decimal(search) }] : []),
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.bankStatementLine.findMany({ where, include: lineInclude, orderBy: [{ txnAt: q.order }, { lineNo: 'asc' }], skip: q.skip, take: q.perPage }),
      this.prisma.bankStatementLine.count({ where }),
    ]);
    return Paginated.of(rows.map((l) => this.lineDto(l)), total, q);
  }

  /** Unmatched payments with the line's amount, closest transfer time first. */
  async candidates(lineId: string, user: AuthUser) {
    const line = await this.line(lineId, user);
    const span = 3 * 86400_000;
    const from = new Date(line.txnAt.getTime() - span);
    const to = new Date(line.txnAt.getTime() + span);
    const payments = await this.prisma.payment.findMany({
      where: {
        ...MATCHABLE,
        ...this.accountPayments(line.bankAccount),
        amount: line.amount,
        statementLines: { none: { matchStatus: LIVE_MATCH } },
        OR: [{ transferredAt: { gte: from, lte: to } }, { transferredAt: null, submittedAt: { gte: from, lte: to } }],
      },
      include: { order: { select: { orderNo: true, payerName: true, event: { select: { code: true, titleTh: true } } } } },
      take: 50,
    });
    const t = line.txnAt.getTime();
    return payments
      .map((p) => ({
        id: p.id,
        paymentNo: p.paymentNo,
        status: p.status,
        amount: moneyOut(p.amount),
        transferredAt: p.transferredAt?.toISOString() ?? null,
        submittedAt: p.submittedAt.toISOString(),
        orderNo: p.order.orderNo,
        payerName: p.order.payerName,
        eventCode: p.order.event.code,
        eventTitle: p.order.event.titleTh,
        minutesApart: Math.round(Math.abs((p.transferredAt ?? p.submittedAt).getTime() - t) / 60_000),
      }))
      .sort((a, b) => a.minutesApart - b.minutesApart);
  }

  async match(lineId: string, paymentId: string, user: AuthUser, meta: RequestMeta) {
    const line = await this.line(lineId, user);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockAccount(tx, line.bankAccountId);
        const p = await tx.payment.findFirst({
          where: { id: paymentId, ...MATCHABLE, ...this.accountPayments(line.bankAccount) },
          include: { statementLines: { where: { matchStatus: LIVE_MATCH } } },
        });
        if (!p) throw Errors.validation('รายการชำระนี้ไม่ใช่การโอนเข้าบัญชีนี้ที่รอตรวจสอบหรือตรวจสอบแล้ว');
        if (!p.amount.equals(line.amount)) throw Errors.validation(`ยอดเงินไม่ตรงกัน (statement ${line.amount.toFixed(2)} / รายการชำระ ${p.amount.toFixed(2)})`);
        if (p.statementLines.length) throw Errors.conflict('PAYMENT_ALREADY_MATCHED', `รายการ ${p.paymentNo} จับคู่กับ statement รายการอื่นแล้ว`);
        const res = await tx.bankStatementLine.updateMany({
          where: { id: lineId, matchStatus: 'UNMATCHED' },
          data: { matchStatus: 'MANUAL', paymentId, matchedById: user.id, matchedAt: new Date(), note: null, version: { increment: 1 } },
        });
        if (res.count !== 1) throw Errors.invalidState('รายการ statement นี้ถูกจับคู่หรือข้ามไปแล้ว — ยกเลิกก่อนจึงจับคู่ใหม่ได้');
        await this.audit.log({ actorId: user.id, action: 'reconcile.match', entityType: 'bank_statement_line', entityId: lineId, after: { paymentId, paymentNo: p.paymentNo, amount: p.amount.toFixed(2) }, meta }, tx);
        return { id: lineId, matchStatus: 'MANUAL', paymentNo: p.paymentNo };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw Errors.conflict('PAYMENT_ALREADY_MATCHED', 'รายการชำระนี้จับคู่กับ statement รายการอื่นแล้ว');
      }
      throw e;
    }
  }

  /** Releases a match or an "ignored" mark; the line becomes UNMATCHED again. */
  async unmatch(lineId: string, reason: string, user: AuthUser, meta: RequestMeta) {
    const line = await this.line(lineId, user);
    return this.prisma.$transaction(async (tx) => {
      await this.lockAccount(tx, line.bankAccountId);
      const res = await tx.bankStatementLine.updateMany({
        where: { id: lineId, matchStatus: { in: ['AUTO', 'MANUAL', 'IGNORED'] } },
        data: { matchStatus: 'UNMATCHED', paymentId: null, matchedById: user.id, matchedAt: new Date(), note: reason, version: { increment: 1 } },
      });
      if (res.count !== 1) throw Errors.invalidState('รายการนี้ยังไม่ได้จับคู่');
      await this.audit.log({ actorId: user.id, action: 'reconcile.unmatch', entityType: 'bank_statement_line', entityId: lineId, before: { matchStatus: line.matchStatus, paymentId: line.paymentId }, after: { matchStatus: 'UNMATCHED' }, reason, meta }, tx);
      return { id: lineId, matchStatus: 'UNMATCHED' };
    });
  }

  /** Marks a credit as not related to registrations (e.g. another income). */
  async ignore(lineId: string, reason: string, user: AuthUser, meta: RequestMeta) {
    const line = await this.line(lineId, user);
    return this.prisma.$transaction(async (tx) => {
      await this.lockAccount(tx, line.bankAccountId);
      const res = await tx.bankStatementLine.updateMany({
        where: { id: lineId, matchStatus: 'UNMATCHED' },
        data: { matchStatus: 'IGNORED', matchedById: user.id, matchedAt: new Date(), note: reason, version: { increment: 1 } },
      });
      if (res.count !== 1) throw Errors.invalidState('ข้ามได้เฉพาะรายการที่ยังไม่จับคู่');
      await this.audit.log({ actorId: user.id, action: 'reconcile.ignore', entityType: 'bank_statement_line', entityId: lineId, after: { matchStatus: 'IGNORED' }, reason, meta }, tx);
      return { id: lineId, matchStatus: 'IGNORED' };
    });
  }

  /**
   * Reconciliation report for a period (default: everything the uploaded statements cover):
   * totals, credits without a payment, verified transfers not seen on the statement, and matches
   * that point at a payment which is no longer valid (rejected / voided after matching).
   */
  async report(q: ReconReportQueryDto, user: AuthUser) {
    const account = await this.account(q.bankAccountId, user);
    const cover = await this.prisma.bankStatement.aggregate({ where: { bankAccountId: account.id }, _min: { periodFrom: true }, _max: { periodTo: true } });
    const from = q.from ? new Date(q.from) : cover._min.periodFrom;
    const to = q.to ? new Date(q.to) : cover._max.periodTo;
    if (!from || !to) {
      return { from: null, to: null, lines: null, unmatchedLines: [], missingPayments: [], invalidMatches: [] };
    }
    const lineWhere = { bankAccountId: account.id, txnAt: { gte: from, lte: to } } satisfies Prisma.BankStatementLineWhereInput;
    const byStatus = await this.prisma.bankStatementLine.groupBy({ by: ['matchStatus'], where: lineWhere, _count: { _all: true }, _sum: { amount: true }, orderBy: { matchStatus: 'asc' } });
    const stat = (...s: string[]) => {
      const rows = byStatus.filter((r) => s.includes(r.matchStatus));
      return {
        count: rows.reduce((a, r) => a + ((r._count as { _all: number })._all ?? 0), 0),
        amount: moneyOut(rows.reduce((a, r) => a.plus(r._sum?.amount ?? 0), new Prisma.Decimal(0))),
      };
    };
    // A day of slack on each side: a transfer late on the last day may be booked the next morning.
    const slack = 86400_000;
    const [unmatchedLines, missingPayments, invalidMatches] = await Promise.all([
      this.prisma.bankStatementLine.findMany({ where: { ...lineWhere, matchStatus: 'UNMATCHED' }, include: lineInclude, orderBy: { txnAt: 'asc' }, take: 500 }),
      this.prisma.payment.findMany({
        where: {
          channel: 'TRANSFER',
          status: 'VERIFIED',
          ...this.accountPayments(account),
          statementLines: { none: { matchStatus: LIVE_MATCH } },
          OR: [
            { transferredAt: { gte: new Date(from.getTime() + slack), lte: new Date(to.getTime() - slack) } },
            { transferredAt: null, submittedAt: { gte: new Date(from.getTime() + slack), lte: new Date(to.getTime() - slack) } },
          ],
        },
        include: { order: { select: { orderNo: true, payerName: true, event: { select: { code: true } } } }, verifiedBy: { select: { displayName: true } } },
        orderBy: { submittedAt: 'asc' },
        take: 500,
      }),
      this.prisma.bankStatementLine.findMany({ where: { ...lineWhere, matchStatus: LIVE_MATCH, payment: { status: { in: ['REJECTED', 'VOIDED'] } } }, include: lineInclude, take: 500 }),
    ]);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      lines: { total: stat('UNMATCHED', 'AUTO', 'MANUAL', 'IGNORED'), matched: stat('AUTO', 'MANUAL'), unmatched: stat('UNMATCHED'), ignored: stat('IGNORED') },
      unmatchedLines: unmatchedLines.map((l) => this.lineDto(l)),
      missingPayments: missingPayments.map((p) => ({
        id: p.id,
        paymentNo: p.paymentNo,
        amount: moneyOut(p.amount),
        transferredAt: p.transferredAt?.toISOString() ?? null,
        submittedAt: p.submittedAt.toISOString(),
        orderNo: p.order.orderNo,
        payerName: p.order.payerName,
        eventCode: p.order.event.code,
        verifiedByName: p.verifiedBy?.displayName ?? null,
      })),
      invalidMatches: invalidMatches.map((l) => this.lineDto(l)),
    };
  }

  /** CSV layout the parser understands out of the box (UTF-8 with BOM so Excel shows Thai). */
  template() {
    return '﻿วันที่,เวลา,รายละเอียด,ถอน,ฝาก,คงเหลือ,เลขอ้างอิง\r\n05/11/2569,09:15,โอนเข้า ตัวอย่าง,,"1,500.00","10,000.00",REF0001\r\n';
  }

  // ───────────── helpers ─────────────

  /** Payments into this account = orders whose receiving-account snapshot has its number. */
  private accountPayments(account: Pick<BankAccount, 'accountNo'>): Prisma.PaymentWhereInput {
    return { order: { bankAccountSnapshot: { path: ['accountNo'], equals: account.accountNo } } };
  }

  private async lockAccount(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM bank_accounts WHERE id = ${id}::uuid FOR UPDATE`;
  }

  private async account(id: string, user: AuthUser) {
    const a = await this.prisma.bankAccount.findUnique({ where: { id } });
    if (!a) throw Errors.notFound('บัญชีรับเงิน');
    if (a.organizationId) {
      await this.access.assertOrg(user, 'finance_batch:reconcile', a.organizationId);
    } else if ((await this.access.orgScope(user, 'finance_batch:reconcile')) !== 'ALL') {
      throw Errors.forbidden('บัญชีส่วนกลางกระทบยอดได้เฉพาะผู้มีสิทธิ์ระดับมหาวิทยาลัย');
    }
    return a;
  }

  private async line(id: string, user: AuthUser) {
    const l = await this.prisma.bankStatementLine.findUnique({ where: { id }, include: { bankAccount: true } });
    if (!l) throw Errors.notFound('รายการ statement');
    await this.account(l.bankAccountId, user);
    return l;
  }

  /** XLSX (zip magic) or CSV text → rows of cells. */
  private async readRows(buf: Buffer): Promise<Cell[][]> {
    if (buf[0] === 0x50 && buf[1] === 0x4b) {
      const wb = new ExcelJS.Workbook();
      try {
        await wb.xlsx.load(buf as unknown as ArrayBuffer);
      } catch {
        throw new AppError('FILE_TYPE_NOT_ALLOWED', 'อ่านไฟล์ Excel ไม่ได้ (รองรับ .xlsx และ .csv)', HttpStatus.UNSUPPORTED_MEDIA_TYPE);
      }
      const ws = wb.worksheets[0];
      if (!ws) return [];
      const rows: Cell[][] = [];
      ws.eachRow({ includeEmpty: true }, (row, n) => {
        const values: Cell[] = [];
        row.eachCell({ includeEmpty: true }, (c, col) => (values[col - 1] = cellValue(c.value)));
        rows[n - 1] = values;
      });
      return Array.from(rows, (r) => r ?? []);
    }
    if (buf.subarray(0, 512).includes(0)) {
      throw new AppError('FILE_TYPE_NOT_ALLOWED', 'รองรับเฉพาะไฟล์ .csv และ .xlsx', HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }
    return parseCsv(decodeText(buf));
  }

  private lineDto(l: LineRow) {
    return {
      id: l.id,
      statementNo: l.statement.statementNo,
      lineNo: l.lineNo,
      txnAt: l.txnAt.toISOString(),
      amount: moneyOut(l.amount),
      description: l.description,
      reference: l.reference,
      matchStatus: l.matchStatus,
      note: l.note,
      matchedAt: l.matchedAt?.toISOString() ?? null,
      matchedByName: l.matchedBy?.displayName ?? (l.matchStatus === 'AUTO' ? 'ระบบ' : null),
      payment: l.payment
        ? {
            id: l.payment.id,
            paymentNo: l.payment.paymentNo,
            status: l.payment.status,
            transferredAt: l.payment.transferredAt?.toISOString() ?? null,
            submittedAt: l.payment.submittedAt.toISOString(),
            orderNo: l.payment.order.orderNo,
            payerName: l.payment.order.payerName,
            eventCode: l.payment.order.event.code,
          }
        : null,
    };
  }
}

/** ExcelJS cell value → plain value (rich text, formulas and hyperlinks flattened). */
function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === 'string' || typeof v === 'number') return v;
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return cellValue(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text);
  }
  return String(v);
}
