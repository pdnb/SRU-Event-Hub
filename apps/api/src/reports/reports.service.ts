import { Injectable, StreamableFile } from '@nestjs/common';
import { fiscalYearBE, fiscalYearRange, formatThaiDate, sanitizeSpreadsheetCell } from '@sru/shared-utils';
import ExcelJS from 'exceljs';
import type { AuthUser } from '../auth/auth.types';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import type { RequestMeta } from '../common/decorators';
import { Errors } from '../common/errors';
import { Paginated } from '../common/pagination';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventReportQueryDto, ReportFilterDto } from './reports.dto';

/** Statuses that count as a real (approved) event in reports. */
const REPORTED = ['APPROVED', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
const MAX_SPAN_DAYS = 3 * 366;

const num = (v: unknown): number => (v == null ? 0 : typeof v === 'bigint' ? Number(v) : typeof v === 'object' && 'toNumber' in (v as object) ? (v as Prisma.Decimal).toNumber() : Number(v));
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const rate = (a: number, b: number) => (b ? round((a / b) * 100, 1) : null);

/** Every month of the period (Asia/Bangkok, YYYY-MM) with zeros where nothing happened — a time axis must not skip months. */
export function fillMonths<T extends { month: string }>(from: Date, to: Date, rows: T[], zero: Omit<T, 'month'>): T[] {
  const bkk = (d: Date) => new Date(d.getTime() + 7 * 3600_000);
  const start = bkk(from);
  const end = bkk(new Date(to.getTime() - 1));
  const by = new Map(rows.map((r) => [r.month, r]));
  const out: T[] = [];
  for (let y = start.getUTCFullYear(), m = start.getUTCMonth(); y < end.getUTCFullYear() || (y === end.getUTCFullYear() && m <= end.getUTCMonth()); m === 11 ? (y++, (m = 0)) : m++) {
    const key = `${y}-${String(m + 1).padStart(2, '0')}`;
    out.push(by.get(key) ?? ({ ...zero, month: key } as T));
    if (out.length > 40) break;
  }
  return out;
}

interface Scope {
  from: Date;
  to: Date;
  /** SQL fragment over `events e` (scope + filters, without the period). */
  where: Prisma.Sql;
  label: string;
}

export interface EventRow {
  id: string;
  code: string;
  titleTh: string;
  organizationName: string;
  categoryName: string | null;
  status: string;
  startAt: Date;
  endAt: Date;
  capacity: number | null;
  confirmed: number;
  attended: number;
  attendanceRate: number | null;
  collected: number;
  refunded: number;
  certificates: number;
  responses: number;
  satisfaction: number | null;
}

/**
 * Reports (spec §4.14 / §10): KPIs, monthly trend and breakdowns over the events a user may see
 * (`report:view` data scope — ALL, organization (tree) or own events). Every query is one SQL
 * statement over a scoped event set; money comes from VERIFIED payments and PAID refunds only.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  // ───────────── scope ─────────────

  async scope(user: AuthUser, f: ReportFilterDto, code: 'report:view' | 'report:export' = 'report:view'): Promise<Scope> {
    if (!this.access.has(user, code)) throw Errors.forbidden();
    const fy = f.fiscalYear ?? fiscalYearBE();
    const range = fiscalYearRange(fy);
    const from = f.from ? new Date(f.from) : range.start;
    const to = f.to ? new Date(f.to) : range.end;
    if (!(to > from)) throw Errors.validation('วันที่สิ้นสุดต้องหลังวันที่เริ่ม');
    if (to.getTime() - from.getTime() > MAX_SPAN_DAYS * 86400_000) throw Errors.validation('ช่วงเวลารายงานยาวเกิน 3 ปี');

    const parts: Prisma.Sql[] = [Prisma.sql`e.deleted_at IS NULL`, Prisma.sql`e.status::text = ANY(${REPORTED})`];
    if (this.access.ownOnly(user, code)) {
      parts.push(Prisma.sql`(e.owner_user_id = ${user.id}::uuid OR e.created_by_id = ${user.id}::uuid)`);
    } else {
      const scope = await this.access.orgScope(user, code);
      let orgs: string[] | null = scope === 'ALL' ? null : scope;
      if (f.organizationId) {
        const tree = await this.access.descendants([f.organizationId]);
        orgs = orgs ? tree.filter((id) => orgs!.includes(id)) : tree;
      }
      if (orgs) parts.push(Prisma.sql`e.organization_id = ANY(${orgs}::uuid[])`);
    }
    if (f.categoryId) parts.push(Prisma.sql`e.category_id = ${f.categoryId}::uuid`);
    if (f.eventTypeId) parts.push(Prisma.sql`e.event_type_id = ${f.eventTypeId}::uuid`);
    return { from, to, where: Prisma.join(parts, ' AND '), label: `${formatThaiDate(from)} – ${formatThaiDate(new Date(to.getTime() - 1))}` };
  }

  /** Events in scope whose start falls in the period. */
  private ev(s: Scope) {
    return Prisma.sql`SELECT e.* FROM events e WHERE ${s.where} AND e.start_at >= ${s.from} AND e.start_at < ${s.to}`;
  }

  /** Per-event metrics (one row per event in the period). */
  private metrics(s: Scope) {
    return Prisma.sql`
      SELECT ev.id, ev.code, ev.title_th, ev.status::text AS status, ev.start_at, ev.end_at, ev.capacity, ev.organization_id, ev.category_id,
        (SELECT count(*) FROM registrations r WHERE r.event_id = ev.id AND r.status = 'CONFIRMED') AS confirmed,
        (SELECT count(*) FROM attendance_records a WHERE a.event_id = ev.id AND a.schedule_id IS NULL AND a.status IN ('PRESENT', 'LATE')) AS attended,
        (SELECT coalesce(sum(p.amount), 0) FROM payments p JOIN payment_orders o ON o.id = p.order_id WHERE o.event_id = ev.id AND p.status = 'VERIFIED') AS collected,
        (SELECT coalesce(sum(f.amount), 0) FROM refunds f JOIN payment_orders o ON o.id = f.order_id WHERE o.event_id = ev.id AND f.status = 'PAID') AS refunded,
        (SELECT count(*) FROM certificates c WHERE c.event_id = ev.id AND c.status = 'ISSUED') AS certificates,
        (SELECT count(*) FROM evaluation_responses er WHERE er.event_id = ev.id) AS responses,
        (SELECT avg(an.value_number)::float FROM evaluation_answers an
           JOIN evaluation_questions q ON q.id = an.question_id
           JOIN evaluation_responses er ON er.id = an.response_id
         WHERE er.event_id = ev.id AND q.kind = 'RATING' AND q.scale_max = 5) AS satisfaction
      FROM (${this.ev(s)}) ev`;
  }

  // ───────────── overview ─────────────

  async overview(user: AuthUser, f: ReportFilterDto) {
    const s = await this.scope(user, f);
    const now = new Date();
    const [tot] = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      WITH m AS (${this.metrics(s)})
      SELECT count(*) AS events,
        count(*) FILTER (WHERE status = 'CANCELLED') AS cancelled,
        count(*) FILTER (WHERE status = 'COMPLETED' OR (status <> 'CANCELLED' AND end_at < ${now})) AS held,
        count(*) FILTER (WHERE status <> 'CANCELLED' AND start_at > ${now}) AS upcoming,
        coalesce(sum(confirmed), 0) AS confirmed,
        coalesce(sum(attended), 0) AS attended,
        coalesce(sum(confirmed) FILTER (WHERE end_at < ${now} AND status <> 'CANCELLED'), 0) AS confirmed_ended,
        coalesce(sum(attended) FILTER (WHERE end_at < ${now} AND status <> 'CANCELLED'), 0) AS attended_ended,
        coalesce(sum(collected), 0) AS collected,
        coalesce(sum(refunded), 0) AS refunded,
        coalesce(sum(certificates), 0) AS certificates,
        coalesce(sum(responses), 0) AS responses,
        sum(satisfaction * responses) / nullif(sum(responses) FILTER (WHERE satisfaction IS NOT NULL), 0) AS satisfaction
      FROM m`;
    const [uniq] = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(DISTINCT r.email_normalized) AS n FROM registrations r JOIN (${this.ev(s)}) ev ON ev.id = r.event_id WHERE r.status = 'CONFIRMED'`;
    const trend = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      WITH m AS (${this.metrics(s)})
      SELECT to_char(date_trunc('month', start_at AT TIME ZONE 'Asia/Bangkok'), 'YYYY-MM') AS month,
        count(*) FILTER (WHERE status <> 'CANCELLED') AS events, coalesce(sum(confirmed), 0) AS confirmed, coalesce(sum(attended), 0) AS attended, coalesce(sum(collected - refunded), 0) AS net
      FROM m GROUP BY 1 ORDER BY 1`;
    const byOrg = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      WITH m AS (${this.metrics(s)})
      SELECT o.id, o.name_th AS name, count(*) FILTER (WHERE m.status <> 'CANCELLED') AS events, coalesce(sum(m.confirmed), 0) AS confirmed, coalesce(sum(m.attended), 0) AS attended, coalesce(sum(m.collected - m.refunded), 0) AS net
      FROM m JOIN organizations o ON o.id = m.organization_id GROUP BY o.id, o.name_th ORDER BY 3 DESC, 4 DESC LIMIT 15`;
    const byCategory = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      WITH m AS (${this.metrics(s)})
      SELECT coalesce(c.name_th, 'ไม่ระบุหมวดหมู่') AS name, count(*) FILTER (WHERE m.status <> 'CANCELLED') AS events, coalesce(sum(m.confirmed), 0) AS confirmed
      FROM m LEFT JOIN event_categories c ON c.id = m.category_id GROUP BY 1 ORDER BY 2 DESC`;
    const byType = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT pt.name_th AS name, count(*) AS confirmed,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM attendance_records a WHERE a.registration_id = r.id AND a.schedule_id IS NULL AND a.status IN ('PRESENT', 'LATE'))) AS attended
      FROM registrations r JOIN (${this.ev(s)}) ev ON ev.id = r.event_id JOIN participant_types pt ON pt.id = r.participant_type_id
      WHERE r.status = 'CONFIRMED' GROUP BY pt.name_th ORDER BY 2 DESC`;

    const confirmedEnded = num(tot!.confirmed_ended);
    const attendedEnded = num(tot!.attended_ended);
    return {
      period: { from: s.from, to: s.to, label: s.label },
      kpis: {
        events: num(tot!.events),
        held: num(tot!.held),
        upcoming: num(tot!.upcoming),
        cancelled: num(tot!.cancelled),
        confirmed: num(tot!.confirmed),
        uniqueParticipants: num(uniq?.n),
        attended: num(tot!.attended),
        attendanceRate: rate(attendedEnded, confirmedEnded),
        collected: round(num(tot!.collected)),
        refunded: round(num(tot!.refunded)),
        net: round(num(tot!.collected) - num(tot!.refunded)),
        certificates: num(tot!.certificates),
        responses: num(tot!.responses),
        satisfaction: tot!.satisfaction == null ? null : round(num(tot!.satisfaction)),
      },
      trend: fillMonths(s.from, s.to, trend.map((t) => ({ month: String(t.month), events: num(t.events), confirmed: num(t.confirmed), attended: num(t.attended), net: round(num(t.net)) })), { events: 0, confirmed: 0, attended: 0, net: 0 }),
      byOrganization: byOrg.map((o) => ({ id: String(o.id), name: String(o.name), events: num(o.events), confirmed: num(o.confirmed), attended: num(o.attended), net: round(num(o.net)) })),
      byCategory: byCategory.map((c) => ({ name: String(c.name), events: num(c.events), confirmed: num(c.confirmed) })),
      byParticipantType: byType.map((t) => ({ name: String(t.name), confirmed: num(t.confirmed), attended: num(t.attended), attendanceRate: rate(num(t.attended), num(t.confirmed)) })),
    };
  }

  // ───────────── per event ─────────────

  async events(user: AuthUser, q: EventReportQueryDto) {
    const s = await this.scope(user, q);
    const { rows, total } = await this.eventRows(s, q, q.perPage, q.skip);
    return Paginated.of(rows, total, { page: q.page, perPage: q.perPage } as never);
  }

  private async eventRows(s: Scope, q: EventReportQueryDto, limit: number, offset: number) {
    const search = q.search?.trim() ? `%${q.search.trim()}%` : null;
    const sortCol = {
      startAt: Prisma.sql`m.start_at`,
      confirmed: Prisma.sql`m.confirmed`,
      attendanceRate: Prisma.sql`(m.attended::float / nullif(m.confirmed, 0))`,
      revenue: Prisma.sql`(m.collected - m.refunded)`,
      satisfaction: Prisma.sql`m.satisfaction`,
    }[q.sort];
    const dir = q.order === 'asc' ? Prisma.sql`ASC NULLS FIRST` : Prisma.sql`DESC NULLS LAST`;
    const searchSql = search ? Prisma.sql`WHERE (m.title_th ILIKE ${search} OR m.code ILIKE ${search})` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      WITH m AS (${this.metrics(s)})
      SELECT m.*, o.name_th AS organization_name, c.name_th AS category_name, count(*) OVER () AS total
      FROM m JOIN organizations o ON o.id = m.organization_id LEFT JOIN event_categories c ON c.id = m.category_id
      ${searchSql}
      ORDER BY ${sortCol} ${dir}, m.start_at DESC
      LIMIT ${limit} OFFSET ${offset}`;
    return {
      total: rows.length ? num(rows[0]!.total) : 0,
      rows: rows.map(
        (r): EventRow => ({
          id: String(r.id),
          code: String(r.code),
          titleTh: String(r.title_th),
          organizationName: String(r.organization_name),
          categoryName: (r.category_name as string | null) ?? null,
          status: String(r.status),
          startAt: r.start_at as Date,
          endAt: r.end_at as Date,
          capacity: r.capacity == null ? null : num(r.capacity),
          confirmed: num(r.confirmed),
          attended: num(r.attended),
          attendanceRate: (r.end_at as Date) < new Date() ? rate(num(r.attended), num(r.confirmed)) : null,
          collected: round(num(r.collected)),
          refunded: round(num(r.refunded)),
          certificates: num(r.certificates),
          responses: num(r.responses),
          satisfaction: r.satisfaction == null ? null : round(num(r.satisfaction)),
        }),
      ),
    };
  }

  // ───────────── finance ─────────────

  /** Money by transaction date (verified / refunded within the period) for events in scope. */
  async finance(user: AuthUser, f: ReportFilterDto) {
    const s = await this.scope(user, f);
    if (!this.access.has(user, 'payment:view')) throw Errors.forbidden('ต้องมีสิทธิ์ดูข้อมูลการเงิน');
    const scoped = Prisma.sql`SELECT e.id FROM events e WHERE ${s.where}`;
    const monthly = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT month, sum(transfer) AS transfer, sum(onsite) AS onsite, sum(refunded) AS refunded FROM (
        SELECT to_char(date_trunc('month', p.verified_at AT TIME ZONE 'Asia/Bangkok'), 'YYYY-MM') AS month,
          CASE WHEN p.channel = 'TRANSFER' THEN p.amount ELSE 0 END AS transfer, CASE WHEN p.channel = 'ONSITE' THEN p.amount ELSE 0 END AS onsite, 0 AS refunded
        FROM payments p JOIN payment_orders o ON o.id = p.order_id
        WHERE p.status = 'VERIFIED' AND p.verified_at >= ${s.from} AND p.verified_at < ${s.to} AND o.event_id IN (${scoped})
        UNION ALL
        SELECT to_char(date_trunc('month', f.paid_at AT TIME ZONE 'Asia/Bangkok'), 'YYYY-MM'), 0, 0, f.amount
        FROM refunds f JOIN payment_orders o ON o.id = f.order_id
        WHERE f.status = 'PAID' AND f.paid_at >= ${s.from} AND f.paid_at < ${s.to} AND o.event_id IN (${scoped})
      ) x GROUP BY month ORDER BY month`;
    const [pending] = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT
        (SELECT count(*) FROM payments p JOIN payment_orders o ON o.id = p.order_id WHERE p.status = 'SUBMITTED' AND o.event_id IN (${scoped})) AS slips_pending,
        (SELECT coalesce(sum(p.amount), 0) FROM payments p JOIN payment_orders o ON o.id = p.order_id WHERE p.status = 'SUBMITTED' AND o.event_id IN (${scoped})) AS slips_amount,
        (SELECT count(*) FROM payment_orders o WHERE o.status = 'UNPAID' AND o.event_id IN (${scoped})) AS orders_unpaid,
        (SELECT coalesce(sum(o.amount), 0) FROM payment_orders o WHERE o.status = 'UNPAID' AND o.event_id IN (${scoped})) AS unpaid_amount,
        (SELECT count(*) FROM refunds f JOIN payment_orders o ON o.id = f.order_id WHERE f.status IN ('REQUESTED', 'APPROVED') AND o.event_id IN (${scoped})) AS refunds_open`;
    const rows = fillMonths(s.from, s.to, monthly.map((m) => ({ month: String(m.month), transfer: round(num(m.transfer)), onsite: round(num(m.onsite)), refunded: round(num(m.refunded)), net: round(num(m.transfer) + num(m.onsite) - num(m.refunded)) })), { transfer: 0, onsite: 0, refunded: 0, net: 0 });
    const sum = (k: 'transfer' | 'onsite' | 'refunded' | 'net') => round(rows.reduce((a, r) => a + r[k], 0));
    return {
      period: { from: s.from, to: s.to, label: s.label },
      totals: { transfer: sum('transfer'), onsite: sum('onsite'), refunded: sum('refunded'), net: sum('net') },
      monthly: rows,
      outstanding: {
        slipsPending: num(pending!.slips_pending),
        slipsAmount: round(num(pending!.slips_amount)),
        ordersUnpaid: num(pending!.orders_unpaid),
        unpaidAmount: round(num(pending!.unpaid_amount)),
        refundsOpen: num(pending!.refunds_open),
      },
    };
  }

  // ───────────── participants ─────────────

  async participants(user: AuthUser, f: ReportFilterDto) {
    const s = await this.scope(user, f);
    const regs = Prisma.sql`SELECT r.* FROM registrations r JOIN (${this.ev(s)}) ev ON ev.id = r.event_id WHERE r.status = 'CONFIRMED'`;
    const [tot] = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      WITH r AS (${regs}), per AS (SELECT email_normalized, count(*) AS n FROM r GROUP BY 1)
      SELECT (SELECT count(*) FROM r) AS registrations, (SELECT count(*) FROM per) AS unique_people,
        (SELECT count(*) FROM per WHERE n > 1) AS repeat_people, (SELECT count(*) FROM r WHERE group_id IS NOT NULL) AS via_groups,
        (SELECT count(*) FROM r WHERE user_id IS NULL) AS guests`;
    const affiliations = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      WITH r AS (${regs})
      SELECT coalesce(nullif(btrim(affiliation), ''), 'ไม่ระบุ') AS name, count(*) AS n, count(DISTINCT email_normalized) AS people FROM r GROUP BY 1 ORDER BY 2 DESC LIMIT 20`;
    const frequency = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      WITH r AS (${regs}), per AS (SELECT email_normalized, count(*) AS n FROM r GROUP BY 1)
      SELECT least(n, 5) AS events, count(*) AS people FROM per GROUP BY 1 ORDER BY 1`;
    return {
      period: { from: s.from, to: s.to, label: s.label },
      totals: { registrations: num(tot!.registrations), uniquePeople: num(tot!.unique_people), repeatPeople: num(tot!.repeat_people), viaGroups: num(tot!.via_groups), guests: num(tot!.guests) },
      topAffiliations: affiliations.map((a) => ({ name: String(a.name), registrations: num(a.n), people: num(a.people) })),
      /** How many people joined 1, 2, 3, 4, 5+ events. */
      frequency: frequency.map((x) => ({ events: num(x.events), people: num(x.people) })),
    };
  }

  // ───────────── export ─────────────

  async export(user: AuthUser, q: EventReportQueryDto, meta: RequestMeta) {
    const s = await this.scope(user, q, 'report:export');
    const overview = await this.overview(user, q);
    const { rows } = await this.eventRows(s, q, 5000, 0);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'SRU Event Hub';
    const k = overview.kpis;
    const o = wb.addWorksheet('สรุป');
    o.addRow([`รายงานกิจกรรม ${s.label}`]).font = { bold: true, size: 14 };
    o.addRow([]);
    for (const [label, value] of [
      ['จำนวนกิจกรรม (ไม่รวมยกเลิก)', k.events - k.cancelled], ['จัดแล้ว', k.held], ['กำลังจะจัด', k.upcoming], ['ยกเลิก', k.cancelled],
      ['ผู้ลงทะเบียน (ยืนยันแล้ว)', k.confirmed], ['ผู้เข้าร่วมไม่ซ้ำ (คน)', k.uniqueParticipants], ['ผู้เข้าร่วมจริง', k.attended], ['อัตราการเข้าร่วม (%)', k.attendanceRate ?? '-'],
      ['รายรับที่ตรวจแล้ว (บาท)', k.collected], ['คืนเงิน (บาท)', k.refunded], ['รายรับสุทธิ (บาท)', k.net], ['เกียรติบัตรที่ออก', k.certificates], ['ผู้ตอบแบบประเมิน', k.responses], ['ความพึงพอใจเฉลี่ย (5)', k.satisfaction ?? '-'],
    ] as const) o.addRow([label, value]);
    o.getColumn(1).width = 34;
    o.getColumn(2).width = 18;

    const ws = wb.addWorksheet('รายกิจกรรม');
    ws.addRow(['รหัส', 'กิจกรรม', 'หน่วยงาน', 'หมวดหมู่', 'วันที่เริ่ม', 'สถานะ', 'รับได้', 'ยืนยันแล้ว', 'เข้าร่วม', 'อัตราเข้าร่วม (%)', 'รายรับ', 'คืนเงิน', 'สุทธิ', 'เกียรติบัตร', 'ผู้ตอบประเมิน', 'ความพึงพอใจ']).font = { bold: true };
    for (const r of rows) {
      ws.addRow([
        r.code, sanitizeSpreadsheetCell(r.titleTh), sanitizeSpreadsheetCell(r.organizationName), sanitizeSpreadsheetCell(r.categoryName ?? ''), formatThaiDate(r.startAt), r.status,
        r.capacity ?? '', r.confirmed, r.attended, r.attendanceRate ?? '', r.collected, r.refunded, round(r.collected - r.refunded), r.certificates, r.responses, r.satisfaction ?? '',
      ]);
    }
    [18, 44, 30, 20, 14, 18, 8, 10, 10, 12, 12, 12, 12, 10, 12, 12].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    for (const [title, data] of [['ตามหน่วยงาน', overview.byOrganization], ['ตามประเภทผู้เข้าร่วม', overview.byParticipantType]] as const) {
      const sh = wb.addWorksheet(title);
      const keys = Object.keys(data[0] ?? { name: '' }).filter((x) => x !== 'id');
      sh.addRow(keys).font = { bold: true };
      for (const d of data) sh.addRow(keys.map((x) => (typeof (d as Record<string, unknown>)[x] === 'string' ? sanitizeSpreadsheetCell(String((d as Record<string, unknown>)[x])) : (d as Record<string, unknown>)[x])));
      sh.getColumn(1).width = 36;
    }
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await this.audit.log({ actorId: user.id, action: 'report.export', entityType: 'report', entityId: null, after: { from: s.from, to: s.to, organizationId: q.organizationId ?? null, events: rows.length }, meta });
    return new StreamableFile(buf, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', disposition: `attachment; filename="report-${s.from.toISOString().slice(0, 10)}.xlsx"` });
  }
}
