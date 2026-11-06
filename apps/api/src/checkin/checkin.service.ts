import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../auth/auth.types';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import type { RequestMeta } from '../common/decorators';
import { AppError, Errors } from '../common/errors';
import { Paginated } from '../common/pagination';
import { uuidv7 } from '../common/uuid';
import type { Env } from '../config/env';
import { CheckinAction, CheckinMethod, Prisma, RegistrationStatus } from '../generated/prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { CheckinGateway } from './checkin.gateway';
import {
  CheckinSettingsDto,
  GroupCheckinDto,
  LocationDto,
  LocationUpdateDto,
  ManualCheckinDto,
  RecordQueryDto,
  ScanDto,
  ScheduleDto,
  SyncItemDto,
} from './checkin.dto';
import { deriveCheckinKey, hashToken, parseQr, qrText, tokenFor } from './checkin-token';
import { EventAccessService, ScopedEvent } from './event-access.service';

/** Event statuses in which people can be checked in. */
const CHECKIN_EVENT_STATUSES = ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS'];
/** Registrations that get a QR: confirmed, or pending payment (the desk sends them to the cashier). */
const QR_STATUSES: RegistrationStatus[] = ['CONFIRMED', 'PENDING_PAYMENT'];
/** Offline captures are accepted for this long (spec FIN-12 uses the same 72 h). */
const OFFLINE_MAX_AGE_MS = 72 * 3600_000;
const CLOCK_SKEW_MS = 2 * 60_000;
const PRESENT = ['PRESENT', 'LATE'] as const;

export type CheckinOutcome = 'CHECKED_IN' | 'ALREADY_CHECKED_IN' | 'CHECKED_OUT' | 'NOT_CHECKED_IN';

export interface RegistrantSummary {
  id: string;
  referenceNo: string;
  fullName: string;
  status: RegistrationStatus;
  participantType: string;
  participantTypeCode: string;
  affiliation: string | null;
  groupId: string | null;
  groupNo: string | null;
  groupName: string | null;
  badgePrints: number;
}

interface Point {
  locationId: string | null;
  scheduleId: string | null;
  action: 'CHECK_IN' | 'CHECK_OUT';
  method: CheckinMethod;
  occurredAt: Date;
  clientKey?: string;
  note?: string;
}

const REG_INCLUDE = {
  participantType: { select: { code: true, nameTh: true } },
  group: { select: { id: true, groupNo: true, name: true } },
  _count: { select: { badgePrints: true } },
} satisfies Prisma.RegistrationInclude;
type RegRow = Prisma.RegistrationGetPayload<{ include: typeof REG_INCLUDE }>;

export const summarize = (r: RegRow): RegistrantSummary => ({
  id: r.id,
  referenceNo: r.referenceNo,
  fullName: `${r.prefix ?? ''}${r.firstName} ${r.lastName}`.trim(),
  status: r.status,
  participantType: r.participantType.nameTh,
  participantTypeCode: r.participantType.code,
  affiliation: r.affiliation,
  groupId: r.group?.id ?? null,
  groupNo: r.group?.groupNo ?? null,
  groupName: r.group?.name ?? null,
  badgePrints: r._count.badgePrints,
});

/**
 * QR check-in, multi-point desks, group check-in, offline sync (spec §4.8) and the attendance it
 * produces (§4.9).
 *
 * Every check-in runs in a transaction holding the registration row lock, so the same QR scanned at
 * two desks at the same moment yields one CHECK_IN and one "already checked in". Records are
 * append-only; mistakes are reversed with an UNDO record. Attendance rows are derived from the
 * records (whole event = schedule NULL, plus one row per session) unless set by hand.
 */
@Injectable()
export class CheckinService {
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: EventAccessService,
    private readonly gateway: CheckinGateway,
    private readonly orgAccess: AccessService,
    config: ConfigService<Env, true>,
  ) {
    this.key = deriveCheckinKey(String(config.get('FIELD_ENCRYPTION_KEY', { infer: true })));
  }

  // ───────────── desk event picker ─────────────

  /**
   * Events the user can run a check-in desk / badge printing for: within the data scope of the
   * permission, or assigned as event personnel with can_checkin. Recent and upcoming only.
   */
  async myEvents(user: AuthUser, purpose: 'checkin' | 'badge') {
    const code = purpose === 'checkin' ? 'checkin:view' : 'badge:view';
    const scopes: Prisma.EventWhereInput[] = [{ personnel: { some: { userId: user.id, canCheckin: true, deletedAt: null } } }];
    if (this.orgAccess.has(user, code)) {
      if (this.orgAccess.ownOnly(user, code)) scopes.push({ OR: [{ ownerUserId: user.id }, { createdById: user.id }] });
      else {
        const scope = await this.orgAccess.orgScope(user, code);
        scopes.push(scope === 'ALL' ? {} : { organizationId: { in: scope } });
      }
    }
    const rows = await this.prisma.event.findMany({
      where: {
        deletedAt: null,
        status: { in: [...CHECKIN_EVENT_STATUSES, 'COMPLETED'] as never[] },
        endAt: { gte: new Date(Date.now() - 30 * 86400_000) },
        OR: scopes,
      },
      select: {
        id: true, code: true, titleTh: true, status: true, startAt: true, endAt: true, venueText: true, checkinOpensBeforeMinutes: true,
        organization: { select: { nameTh: true } },
        _count: { select: { registrations: { where: { status: 'CONFIRMED' } }, attendanceRecords: { where: { scheduleId: null, status: { in: ['PRESENT', 'LATE'] } } } } },
      },
      orderBy: { startAt: 'asc' },
      take: 200,
    });
    const now = new Date();
    return rows.map(({ _count, organization, ...e }) => ({
      ...e,
      organizationName: organization.nameTh,
      confirmed: _count.registrations,
      checkedIn: _count.attendanceRecords,
      isOpen: this.isOpen({ ...e, organizationId: '', ownerUserId: '', createdById: '', checkinLateAfterMinutes: null }, now),
    }));
  }

  // ───────────── settings & locations ─────────────

  async settings(eventId: string, user: AuthUser) {
    const e = await this.access.assert(user, 'checkin:view', eventId);
    const [locations, schedules] = await Promise.all([
      this.prisma.checkinLocation.findMany({ where: { eventId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.eventSchedule.findMany({ where: { eventId }, orderBy: [{ startAt: 'asc' }, { sortOrder: 'asc' }], select: { id: true, title: true, startAt: true, endAt: true, venueText: true } }),
    ]);
    const window = this.window(e);
    return {
      event: { id: e.id, code: e.code, titleTh: e.titleTh, status: e.status, startAt: e.startAt, endAt: e.endAt, venueText: e.venueText },
      opensBeforeMinutes: e.checkinOpensBeforeMinutes,
      lateAfterMinutes: e.checkinLateAfterMinutes,
      opensAt: window.opensAt,
      closesAt: window.closesAt,
      isOpen: this.isOpen(e, new Date()),
      locations,
      schedules,
    };
  }

  async updateSettings(eventId: string, dto: CheckinSettingsDto, user: AuthUser, meta: RequestMeta) {
    const e = await this.access.assert(user, 'checkin:update', eventId);
    await this.prisma.event.update({
      where: { id: eventId },
      data: { checkinOpensBeforeMinutes: dto.opensBeforeMinutes, checkinLateAfterMinutes: dto.lateAfterMinutes ?? null },
    });
    await this.audit.log({
      actorId: user.id, action: 'checkin.settings', entityType: 'event', entityId: eventId, meta,
      before: { opensBeforeMinutes: e.checkinOpensBeforeMinutes, lateAfterMinutes: e.checkinLateAfterMinutes },
      after: { opensBeforeMinutes: dto.opensBeforeMinutes, lateAfterMinutes: dto.lateAfterMinutes ?? null },
    });
    return this.settings(eventId, user);
  }

  async createLocation(eventId: string, dto: LocationDto, user: AuthUser) {
    await this.access.assert(user, 'checkin:update', eventId);
    if (dto.scheduleId) await this.assertSchedule(eventId, dto.scheduleId);
    try {
      return await this.prisma.checkinLocation.create({
        data: { eventId, nameTh: dto.nameTh.trim(), scheduleId: dto.scheduleId ?? null, sortOrder: dto.sortOrder ?? 0, createdById: user.id },
      });
    } catch (e) {
      throw this.duplicateName(e);
    }
  }

  async updateLocation(id: string, dto: LocationUpdateDto, user: AuthUser) {
    const loc = await this.prisma.checkinLocation.findUnique({ where: { id } });
    if (!loc) throw Errors.notFound('จุดเช็กอิน');
    await this.access.assert(user, 'checkin:update', loc.eventId);
    if (dto.scheduleId) await this.assertSchedule(loc.eventId, dto.scheduleId);
    try {
      return await this.prisma.checkinLocation.update({
        where: { id },
        data: {
          ...(dto.nameTh !== undefined ? { nameTh: dto.nameTh.trim() } : {}),
          ...(dto.scheduleId !== undefined ? { scheduleId: dto.scheduleId } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        },
      });
    } catch (e) {
      throw this.duplicateName(e);
    }
  }

  // ───────────── sessions (agenda) ─────────────

  async createSchedule(eventId: string, dto: ScheduleDto, user: AuthUser, meta: RequestMeta) {
    const e = await this.access.assert(user, 'event:update', eventId);
    const range = this.scheduleRange(e, dto);
    const s = await this.prisma.eventSchedule.create({ data: { eventId, title: dto.title.trim(), ...range, venueText: dto.venueText || null, speaker: dto.speaker || null } });
    await this.audit.log({ actorId: user.id, action: 'event_schedule.create', entityType: 'event_schedule', entityId: s.id, after: { eventId, title: s.title }, meta });
    return s;
  }

  async updateSchedule(id: string, dto: ScheduleDto, user: AuthUser, meta: RequestMeta) {
    const cur = await this.prisma.eventSchedule.findUnique({ where: { id } });
    if (!cur) throw Errors.notFound('ช่วงกิจกรรม');
    const e = await this.access.assert(user, 'event:update', cur.eventId);
    const s = await this.prisma.eventSchedule.update({ where: { id }, data: { title: dto.title.trim(), ...this.scheduleRange(e, dto), venueText: dto.venueText || null, speaker: dto.speaker || null } });
    await this.audit.log({ actorId: user.id, action: 'event_schedule.update', entityType: 'event_schedule', entityId: id, before: { title: cur.title, startAt: cur.startAt }, after: { title: s.title, startAt: s.startAt }, meta });
    return s;
  }

  /** Refused once anyone has been checked into the session (attendance history must stay). */
  async deleteSchedule(id: string, user: AuthUser, meta: RequestMeta) {
    const cur = await this.prisma.eventSchedule.findUnique({ where: { id }, include: { _count: { select: { checkinRecords: true, attendanceRecords: true } } } });
    if (!cur) throw Errors.notFound('ช่วงกิจกรรม');
    await this.access.assert(user, 'event:update', cur.eventId);
    if (cur._count.checkinRecords || cur._count.attendanceRecords) throw Errors.invalidState('มีการเช็กอินในช่วงกิจกรรมนี้แล้ว จึงลบไม่ได้');
    await this.prisma.eventSchedule.delete({ where: { id } });
    await this.audit.log({ actorId: user.id, action: 'event_schedule.delete', entityType: 'event_schedule', entityId: id, before: { title: cur.title }, meta });
    return { deleted: true };
  }

  private scheduleRange(e: ScopedEvent, dto: ScheduleDto) {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (endAt <= startAt) throw Errors.validation('เวลาสิ้นสุดต้องหลังเวลาเริ่ม');
    if (startAt < new Date(e.startAt.getTime() - 86400_000) || endAt > new Date(e.endAt.getTime() + 86400_000)) {
      throw Errors.validation('ช่วงเวลาต้องอยู่ในวันที่จัดกิจกรรม');
    }
    return { startAt, endAt };
  }

  // ───────────── QR credentials ─────────────

  /** The signed-in registrant's own QR (or a staff member with check-in rights on the event). */
  async qrForRegistration(registrationId: string, user: AuthUser) {
    const reg = await this.prisma.registration.findUnique({ where: { id: registrationId }, select: { id: true, eventId: true, userId: true, status: true, referenceNo: true } });
    if (!reg) throw Errors.notFound('การลงทะเบียน');
    if (reg.userId !== user.id) await this.access.assert(user, 'checkin:view', reg.eventId);
    return this.qrPayload(reg);
  }

  /** Guest flow: reference number + the access token handed out at registration (no login). */
  async qrForGuest(referenceNo: string, accessToken: string) {
    const reg = await this.prisma.registration.findUnique({ where: { referenceNo }, select: { id: true, eventId: true, status: true, referenceNo: true, accessTokenHash: true } });
    // Same error for unknown reference and wrong token, so references cannot be enumerated.
    if (!reg?.accessTokenHash || reg.accessTokenHash !== hashToken(accessToken)) throw new AppError('NOT_FOUND', 'ไม่พบข้อมูลการลงทะเบียน', HttpStatus.NOT_FOUND);
    return this.qrPayload(reg);
  }

  /** One QR for a whole group, shown to the coordinator (or staff). */
  async qrForGroup(groupId: string, user: AuthUser) {
    const g = await this.prisma.registrationGroup.findUnique({ where: { id: groupId }, select: { id: true, eventId: true, status: true, groupNo: true, coordinatorUserId: true } });
    if (!g) throw Errors.notFound('กลุ่ม');
    if (g.coordinatorUserId !== user.id) await this.access.assert(user, 'checkin:view', g.eventId);
    if (!['CONFIRMED', 'PENDING_PAYMENT'].includes(g.status)) {
      throw Errors.invalidState('QR เช็กอินกลุ่มใช้ได้เมื่อส่งกลุ่มแล้วเท่านั้น');
    }
    const token = await this.ensureToken(this.prisma, { eventId: g.eventId, groupId: g.id });
    return { code: qrText(token), groupNo: g.groupNo, status: g.status };
  }

  /** Revoke the current QR and issue a new one (lost / shared screenshot). Printed badges stop working. */
  async reissue(registrationId: string, reason: string, user: AuthUser, meta: RequestMeta) {
    const reg = await this.prisma.registration.findUnique({ where: { id: registrationId }, select: { id: true, eventId: true, status: true, referenceNo: true } });
    if (!reg) throw Errors.notFound('การลงทะเบียน');
    await this.access.assert(user, 'checkin:update', reg.eventId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${reg.id}::uuid FOR UPDATE`;
      await tx.checkinToken.updateMany({ where: { registrationId: reg.id, revokedAt: null }, data: { revokedAt: new Date(), revokedById: user.id, revokeReason: reason } });
      await this.audit.log({ actorId: user.id, action: 'checkin.token_reissue', entityType: 'registration', entityId: reg.id, reason, meta }, tx);
    });
    return this.qrPayload(reg);
  }

  private async qrPayload(reg: { id: string; eventId: string; status: RegistrationStatus; referenceNo: string }) {
    if (!QR_STATUSES.includes(reg.status)) {
      throw Errors.invalidState('QR เช็กอินออกให้เฉพาะการลงทะเบียนที่ยืนยันแล้ว (หรือรอชำระเงิน)');
    }
    const token = await this.ensureToken(this.prisma, { eventId: reg.eventId, registrationId: reg.id });
    return { code: qrText(token), referenceNo: reg.referenceNo, status: reg.status };
  }

  /** Returns the live token for a registration / group, creating it on first use. */
  async ensureToken(db: Tx | PrismaService, subject: { eventId: string; registrationId?: string; groupId?: string }): Promise<string> {
    const where = subject.registrationId ? { registrationId: subject.registrationId, revokedAt: null } : { groupId: subject.groupId, revokedAt: null };
    const live = await db.checkinToken.findFirst({ where, select: { id: true } });
    if (live) return tokenFor(this.key, live.id);
    const id = uuidv7();
    const token = tokenFor(this.key, id);
    // ON CONFLICT DO NOTHING: a concurrent request may have created the live token first (partial unique index).
    await db.checkinToken.createMany({
      data: [{ id, eventId: subject.eventId, registrationId: subject.registrationId ?? null, groupId: subject.groupId ?? null, tokenHash: hashToken(token) }],
      skipDuplicates: true,
    });
    const now = await db.checkinToken.findFirstOrThrow({ where, select: { id: true } });
    return tokenFor(this.key, now.id);
  }

  /** Bulk variant for badges / offline packs: registrationId → token. */
  async ensureTokens(eventId: string, registrationIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (let i = 0; i < registrationIds.length; i += 1000) {
      const ids = registrationIds.slice(i, i + 1000);
      const live = await this.prisma.checkinToken.findMany({ where: { registrationId: { in: ids }, revokedAt: null }, select: { id: true, registrationId: true } });
      const have = new Set(live.map((t) => t.registrationId));
      const missing = ids.filter((id) => !have.has(id));
      if (missing.length) {
        await this.prisma.checkinToken.createMany({
          data: missing.map((registrationId) => {
            const id = uuidv7();
            return { id, eventId, registrationId, tokenHash: hashToken(tokenFor(this.key, id)) };
          }),
          skipDuplicates: true,
        });
      }
      const all = missing.length ? await this.prisma.checkinToken.findMany({ where: { registrationId: { in: ids }, revokedAt: null }, select: { id: true, registrationId: true } }) : live;
      for (const t of all) out.set(t.registrationId!, tokenFor(this.key, t.id));
    }
    return out;
  }

  // ───────────── scanning ─────────────

  async scan(eventId: string, dto: ScanDto, user: AuthUser) {
    const e = await this.access.assert(user, 'checkin:create', eventId);
    const token = parseQr(dto.code);
    if (!token) throw new AppError('INVALID_QR', 'ไม่ใช่ QR สำหรับเช็กอินของระบบ', HttpStatus.UNPROCESSABLE_ENTITY);
    const row = await this.prisma.checkinToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { event: { select: { code: true, titleTh: true } } },
    });
    if (!row) throw new AppError('QR_NOT_FOUND', 'ไม่พบข้อมูล QR นี้ในระบบ', HttpStatus.NOT_FOUND);
    if (row.revokedAt) throw new AppError('QR_REVOKED', 'QR นี้ถูกยกเลิกแล้ว (มีการออก QR ใหม่) กรุณาใช้ QR ล่าสุด', HttpStatus.CONFLICT);
    if (row.eventId !== eventId) {
      throw new AppError('WRONG_EVENT', `QR นี้เป็นของกิจกรรมอื่น: ${row.event.titleTh}`, HttpStatus.CONFLICT, { event: row.event });
    }
    if (row.groupId) return { kind: 'GROUP' as const, group: await this.groupRoster(row.groupId, dto.scheduleId ?? null, dto.locationId ?? null) };
    const point = await this.point(e, dto, 'QR');
    return { kind: 'REGISTRATION' as const, ...(await this.checkIn(e, row.registrationId!, point, user.id)) };
  }

  async manual(eventId: string, dto: ManualCheckinDto, user: AuthUser) {
    const e = await this.access.assert(user, 'checkin:create', eventId);
    const point = await this.point(e, dto, 'MANUAL');
    return this.checkIn(e, dto.registrationId, { ...point, note: dto.note }, user.id);
  }

  /** Checks in the selected members of a group in one go (each member is still validated). */
  async group(eventId: string, dto: GroupCheckinDto, user: AuthUser) {
    const e = await this.access.assert(user, 'checkin:create', eventId);
    const g = await this.prisma.registrationGroup.findUnique({ where: { id: dto.groupId }, select: { id: true, eventId: true } });
    if (!g || g.eventId !== eventId) throw Errors.notFound('กลุ่มในกิจกรรมนี้');
    const point = await this.point(e, { ...dto, clientKey: undefined }, 'GROUP');
    const ids = [...new Set(dto.registrationIds)];
    const members = await this.prisma.registration.findMany({ where: { id: { in: ids }, groupId: g.id }, select: { id: true } });
    if (members.length !== ids.length) throw Errors.validation('มีรายชื่อที่ไม่ได้อยู่ในกลุ่มนี้');

    const results: { registrationId: string; outcome?: CheckinOutcome; error?: { code: string; message: string } }[] = [];
    for (const id of ids.sort()) {
      try {
        const r = await this.checkIn(e, id, point, user.id, { broadcast: false });
        results.push({ registrationId: id, outcome: r.outcome });
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        results.push({ registrationId: id, error: { code: err.code, message: err.message } });
      }
    }
    const checkedIn = results.filter((r) => r.outcome === 'CHECKED_IN').length;
    if (checkedIn) this.gateway.notify({ eventId, kind: 'CHECK_IN', count: checkedIn });
    return { checkedIn, results, group: await this.groupRoster(g.id, point.scheduleId, point.locationId) };
  }

  /** Replays captures made on a scanner device while offline. Idempotent per client key. */
  async sync(eventId: string, items: SyncItemDto[], user: AuthUser) {
    const e = await this.access.assert(user, 'checkin:create', eventId);
    const now = Date.now();
    const results: { clientKey: string; outcome?: CheckinOutcome | 'DUPLICATE'; error?: { code: string; message: string } }[] = [];
    let changed = 0;
    for (const item of items) {
      try {
        const at = new Date(item.occurredAt);
        if (at.getTime() > now + CLOCK_SKEW_MS || at.getTime() < now - OFFLINE_MAX_AGE_MS) {
          throw Errors.validation('เวลาที่บันทึกไม่อยู่ในช่วงที่ยอมรับ (ไม่เกิน 72 ชั่วโมง และไม่ใช่เวลาในอนาคต)');
        }
        const point = await this.point(e, { ...item, clientKey: item.clientKey }, 'OFFLINE', at);
        const r = await this.checkIn(e, item.registrationId, point, user.id, { broadcast: false });
        if (r.replayed) results.push({ clientKey: item.clientKey, outcome: 'DUPLICATE' });
        else {
          results.push({ clientKey: item.clientKey, outcome: r.outcome });
          if (r.outcome === 'CHECKED_IN' || r.outcome === 'CHECKED_OUT') changed++;
        }
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        results.push({ clientKey: item.clientKey, error: { code: err.code, message: err.message } });
      }
    }
    if (changed) this.gateway.notify({ eventId, kind: 'SYNC', count: changed });
    return { results };
  }

  /**
   * The check-in itself. Lock order: registration row only (no event lock — check-in never
   * touches seats), so it cannot deadlock with registration / payment flows.
   */
  private async checkIn(e: ScopedEvent, registrationId: string, p: Point, actorId: string, opts: { broadcast?: boolean } = {}) {
    if (p.clientKey) {
      const prior = await this.prisma.checkinRecord.findUnique({ where: { clientKey: p.clientKey } });
      if (prior) return this.replay(e, prior);
    }
    try {
      const res = await this.prisma.$transaction(async (tx) => {
        const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM registrations WHERE id = ${registrationId}::uuid FOR UPDATE`;
        if (!locked) throw Errors.notFound('การลงทะเบียน');
        const reg = await tx.registration.findUniqueOrThrow({ where: { id: registrationId }, include: REG_INCLUDE });
        const who = summarize(reg);
        if (reg.eventId !== e.id) throw new AppError('WRONG_EVENT', 'ผู้ลงทะเบียนนี้ไม่ได้อยู่ในกิจกรรมนี้', HttpStatus.CONFLICT, { registration: who });
        this.assertCanCheckIn(e, reg.status, p.occurredAt, who);

        const prior = await this.activeRecords(tx, registrationId, p.scheduleId);
        // prior is newest first → the last CHECK_IN in the list is the earliest one.
        const lastIn = prior.filter((r) => r.action === 'CHECK_IN').at(-1) ?? null;
        if (p.action === 'CHECK_IN' && lastIn) {
          return { outcome: 'ALREADY_CHECKED_IN' as const, record: null, firstCheckinAt: lastIn.occurredAt, who };
        }
        if (p.action === 'CHECK_OUT' && !lastIn) {
          throw new AppError('NOT_CHECKED_IN', 'ยังไม่ได้เช็กอิน จึงเช็กเอาต์ไม่ได้', HttpStatus.CONFLICT, { registration: who });
        }
        const record = await tx.checkinRecord.create({
          data: {
            eventId: e.id, registrationId, locationId: p.locationId, scheduleId: p.scheduleId, action: p.action, method: p.method,
            occurredAt: p.occurredAt, actorId, clientKey: p.clientKey ?? null, note: p.note ?? null,
          },
        });
        await this.recompute(tx, e, registrationId, p.scheduleId, { fromScan: true, actorId });
        if (p.scheduleId) await this.recompute(tx, e, registrationId, null, { fromScan: true, actorId });
        return {
          outcome: (p.action === 'CHECK_IN' ? 'CHECKED_IN' : 'CHECKED_OUT') as CheckinOutcome,
          record: { id: record.id, occurredAt: record.occurredAt },
          firstCheckinAt: p.action === 'CHECK_IN' ? record.occurredAt : lastIn!.occurredAt,
          who,
        };
      });
      if (res.record && opts.broadcast !== false) this.gateway.notify({ eventId: e.id, kind: p.action, count: 1 });
      const attendance = await this.prisma.attendanceRecord.findFirst({ where: { registrationId, scheduleId: p.scheduleId }, select: { status: true, firstCheckinAt: true, lastCheckoutAt: true } });
      return { outcome: res.outcome, replayed: false, record: res.record, firstCheckinAt: res.firstCheckinAt, attendance, registration: res.who, scheduleId: p.scheduleId, locationId: p.locationId };
    } catch (err) {
      // Same client key sent twice concurrently: the loser replays the winner's record.
      if (p.clientKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const prior = await this.prisma.checkinRecord.findUnique({ where: { clientKey: p.clientKey } });
        if (prior) return this.replay(e, prior);
      }
      throw err;
    }
  }

  private async replay(e: ScopedEvent, prior: { id: string; registrationId: string; action: CheckinAction; occurredAt: Date; scheduleId: string | null; locationId: string | null }) {
    const reg = await this.prisma.registration.findUniqueOrThrow({ where: { id: prior.registrationId }, include: REG_INCLUDE });
    if (reg.eventId !== e.id) throw Errors.conflict('IDEMPOTENCY_CONFLICT', 'รหัสอ้างอิงรายการนี้ถูกใช้กับข้อมูลอื่นแล้ว');
    const attendance = await this.prisma.attendanceRecord.findFirst({ where: { registrationId: reg.id, scheduleId: prior.scheduleId }, select: { status: true, firstCheckinAt: true, lastCheckoutAt: true } });
    return {
      outcome: (prior.action === 'CHECK_OUT' ? 'CHECKED_OUT' : 'CHECKED_IN') as CheckinOutcome,
      replayed: true,
      record: { id: prior.id, occurredAt: prior.occurredAt },
      firstCheckinAt: attendance?.firstCheckinAt ?? prior.occurredAt,
      attendance,
      registration: summarize(reg),
      scheduleId: prior.scheduleId,
      locationId: prior.locationId,
    };
  }

  /** Reverses a check-in / check-out (wrong person scanned). Requires a reason; audited. */
  async undo(recordId: string, reason: string, user: AuthUser, meta: RequestMeta) {
    const rec = await this.prisma.checkinRecord.findUnique({ where: { id: recordId }, include: { undoneBy: { select: { id: true } } } });
    if (!rec) throw Errors.notFound('รายการเช็กอิน');
    const e = await this.access.assert(user, 'checkin:update', rec.eventId);
    if (rec.action === 'UNDO') throw Errors.invalidState('รายการนี้เป็นการยกเลิกอยู่แล้ว');
    if (rec.undoneBy) throw Errors.invalidState('รายการนี้ถูกยกเลิกไปแล้ว');
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM registrations WHERE id = ${rec.registrationId}::uuid FOR UPDATE`;
        await tx.checkinRecord.create({
          data: { eventId: rec.eventId, registrationId: rec.registrationId, locationId: rec.locationId, scheduleId: rec.scheduleId, action: 'UNDO', method: 'MANUAL', occurredAt: new Date(), actorId: user.id, undoesId: rec.id, note: reason },
        });
        await this.recompute(tx, e, rec.registrationId, rec.scheduleId, { fromScan: false, actorId: user.id });
        if (rec.scheduleId) await this.recompute(tx, e, rec.registrationId, null, { fromScan: false, actorId: user.id });
        await this.audit.log({ actorId: user.id, action: 'checkin.undo', entityType: 'checkin_record', entityId: rec.id, before: { action: rec.action, occurredAt: rec.occurredAt }, reason, meta }, tx);
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw Errors.invalidState('รายการนี้ถูกยกเลิกไปแล้ว');
      throw err;
    }
    this.gateway.notify({ eventId: rec.eventId, kind: 'UNDO', count: 1 });
    return { undone: true };
  }

  // ───────────── attendance derivation ─────────────

  /**
   * Live (not undone) CHECK_IN / CHECK_OUT records, newest first. For the whole event (schedule NULL)
   * any session counts: attending a session means attending the event.
   */
  private activeRecords(tx: Tx, registrationId: string, scheduleId: string | null) {
    return tx.checkinRecord.findMany({
      where: { registrationId, action: { in: ['CHECK_IN', 'CHECK_OUT'] }, undoneBy: { is: null }, ...(scheduleId ? { scheduleId } : {}) },
      orderBy: { occurredAt: 'desc' },
      select: { id: true, action: true, occurredAt: true },
    });
  }

  /**
   * Rebuilds one attendance row from the records. A row set by hand keeps its status, except that a
   * real scan (fromScan) overrides a manual "absent/excused".
   */
  private async recompute(tx: Tx, e: ScopedEvent, registrationId: string, scheduleId: string | null, opts: { fromScan: boolean; actorId: string }) {
    const recs = await this.activeRecords(tx, registrationId, scheduleId);
    const ins = recs.filter((r) => r.action === 'CHECK_IN');
    const firstIn = ins.length ? ins[ins.length - 1]!.occurredAt : null;
    const lastOut = recs.find((r) => r.action === 'CHECK_OUT')?.occurredAt ?? null;
    const existing = await tx.attendanceRecord.findFirst({ where: { registrationId, scheduleId } });

    if (!firstIn) {
      if (existing && !existing.isManual) await tx.attendanceRecord.delete({ where: { id: existing.id } });
      else if (existing) await tx.attendanceRecord.update({ where: { id: existing.id }, data: { firstCheckinAt: null, lastCheckoutAt: null } });
      return;
    }
    let start = e.startAt;
    if (scheduleId) {
      const s = await tx.eventSchedule.findUnique({ where: { id: scheduleId }, select: { startAt: true } });
      if (s) start = s.startAt;
    }
    const late = e.checkinLateAfterMinutes !== null && firstIn.getTime() > start.getTime() + e.checkinLateAfterMinutes * 60_000;
    const derived = late ? 'LATE' : 'PRESENT';
    const keepManual = existing?.isManual && !opts.fromScan;
    const data = {
      status: keepManual ? existing!.status : derived,
      isManual: keepManual ? true : false,
      firstCheckinAt: firstIn,
      lastCheckoutAt: lastOut && lastOut > firstIn ? lastOut : null,
      updatedById: opts.actorId,
    };
    if (existing) await tx.attendanceRecord.update({ where: { id: existing.id }, data });
    else await tx.attendanceRecord.create({ data: { eventId: e.id, registrationId, scheduleId, ...data } });
  }

  // ───────────── lookups for the desk ─────────────

  async search(eventId: string, q: string, user: AuthUser) {
    await this.access.assert(user, 'checkin:view', eventId);
    const s = q.trim();
    const rows = await this.prisma.registration.findMany({
      where: {
        eventId,
        status: { in: ['CONFIRMED', 'PENDING_PAYMENT', 'WAITLISTED'] },
        OR: [
          { firstName: { contains: s, mode: 'insensitive' } },
          { lastName: { contains: s, mode: 'insensitive' } },
          { emailNormalized: { contains: s.toLowerCase() } },
          { referenceNo: s.toUpperCase() },
          { studentOrStaffCode: s },
          { phone: s },
          { group: { groupNo: s.toUpperCase() } },
        ],
      },
      include: { ...REG_INCLUDE, attendance: { where: { scheduleId: null }, select: { status: true, firstCheckinAt: true } } },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 20,
    });
    return rows.map((r) => ({ ...summarize(r), attendance: r.attendance[0] ?? null }));
  }

  async groupRosterFor(eventId: string, groupId: string, scheduleId: string | null, user: AuthUser) {
    await this.access.assert(user, 'checkin:view', eventId);
    const g = await this.prisma.registrationGroup.findUnique({ where: { id: groupId }, select: { eventId: true } });
    if (!g || g.eventId !== eventId) throw Errors.notFound('กลุ่มในกิจกรรมนี้');
    if (scheduleId) await this.assertSchedule(eventId, scheduleId);
    return this.groupRoster(groupId, scheduleId, null);
  }

  /** Members of a group with their check-in state for the given session (for the group check-in dialog). */
  async groupRoster(groupId: string, scheduleId: string | null, locationId: string | null) {
    const g = await this.prisma.registrationGroup.findUniqueOrThrow({
      where: { id: groupId },
      select: { id: true, groupNo: true, name: true, status: true, participantOrganization: { select: { nameTh: true } } },
    });
    let sid = scheduleId;
    if (!sid && locationId) sid = (await this.prisma.checkinLocation.findUnique({ where: { id: locationId }, select: { scheduleId: true } }))?.scheduleId ?? null;
    const members = await this.prisma.registration.findMany({
      where: { groupId, status: { notIn: ['DRAFT'] } },
      include: { ...REG_INCLUDE, attendance: { where: { scheduleId: sid }, select: { status: true, firstCheckinAt: true } } },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    return {
      id: g.id,
      groupNo: g.groupNo,
      name: g.name,
      status: g.status,
      organizationName: g.participantOrganization.nameTh,
      members: members.map((m) => ({ ...summarize(m), attendance: m.attendance[0] ?? null })),
    };
  }

  async records(eventId: string, q: RecordQueryDto, user: AuthUser) {
    await this.access.assert(user, 'checkin:view', eventId);
    const where: Prisma.CheckinRecordWhereInput = {
      eventId,
      ...(q.locationId ? { locationId: q.locationId } : {}),
      ...(q.registrationId ? { registrationId: q.registrationId } : {}),
      ...(q.search
        ? { registration: { OR: [{ firstName: { contains: q.search, mode: 'insensitive' } }, { lastName: { contains: q.search, mode: 'insensitive' } }, { referenceNo: q.search.toUpperCase() }] } }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.checkinRecord.findMany({
        where,
        include: {
          registration: { select: { referenceNo: true, prefix: true, firstName: true, lastName: true } },
          location: { select: { nameTh: true } },
          schedule: { select: { title: true } },
          actor: { select: { displayName: true } },
          undoneBy: { select: { id: true, createdAt: true, note: true } },
        },
        orderBy: { createdAt: q.order },
        skip: q.skip,
        take: q.perPage,
      }),
      this.prisma.checkinRecord.count({ where }),
    ]);
    return Paginated.of(rows.map((r) => this.recordDto(r)), total, q);
  }

  async stats(eventId: string, user: AuthUser) {
    const e = await this.access.assert(user, 'checkin:view', eventId);
    const [statusCounts, attendance, byLocation, byType, bySchedule, hourly, recent, locations, schedules] = await Promise.all([
      this.prisma.registration.groupBy({ by: ['status'], where: { eventId, status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] } }, _count: { _all: true }, orderBy: { status: 'asc' } }),
      this.prisma.attendanceRecord.groupBy({ by: ['status'], where: { eventId, scheduleId: null }, _count: { _all: true }, orderBy: { status: 'asc' } }),
      this.prisma.$queryRaw<{ location_id: string | null; n: bigint }[]>`
        SELECT r.location_id::text, count(DISTINCT r.registration_id) AS n
        FROM checkin_records r
        WHERE r.event_id = ${eventId}::uuid AND r.action = 'CHECK_IN'
          AND NOT EXISTS (SELECT 1 FROM checkin_records u WHERE u.undoes_id = r.id)
        GROUP BY r.location_id`,
      this.prisma.$queryRaw<{ code: string; name: string; registered: bigint; present: bigint }[]>`
        SELECT pt.code, pt.name_th AS name, count(*) AS registered,
               count(a.id) FILTER (WHERE a.status IN ('PRESENT', 'LATE')) AS present
        FROM registrations g
        JOIN participant_types pt ON pt.id = g.participant_type_id
        LEFT JOIN attendance_records a ON a.registration_id = g.id AND a.schedule_id IS NULL
        WHERE g.event_id = ${eventId}::uuid AND g.status = 'CONFIRMED'
        GROUP BY pt.code, pt.name_th, pt.sort_order ORDER BY pt.sort_order`,
      this.prisma.attendanceRecord.groupBy({ by: ['scheduleId'], where: { eventId, scheduleId: { not: null }, status: { in: [...PRESENT] } }, _count: { _all: true }, orderBy: { scheduleId: 'asc' } }),
      this.prisma.$queryRaw<{ hour: Date; n: bigint }[]>`
        SELECT date_trunc('hour', first_checkin_at) AS hour, count(*) AS n
        FROM attendance_records
        WHERE event_id = ${eventId}::uuid AND schedule_id IS NULL AND first_checkin_at IS NOT NULL
        GROUP BY 1 ORDER BY 1 DESC LIMIT 48`,
      this.prisma.checkinRecord.findMany({
        where: { eventId },
        include: {
          registration: { select: { referenceNo: true, prefix: true, firstName: true, lastName: true } },
          location: { select: { nameTh: true } },
          schedule: { select: { title: true } },
          actor: { select: { displayName: true } },
          undoneBy: { select: { id: true, createdAt: true, note: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 15,
      }),
      this.prisma.checkinLocation.findMany({ where: { eventId }, select: { id: true, nameTh: true, isActive: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.eventSchedule.findMany({ where: { eventId }, select: { id: true, title: true, startAt: true }, orderBy: { startAt: 'asc' } }),
    ]);
    const count = (rows: { status: string; _count: unknown }[], s: string) => (rows.find((r) => r.status === s)?._count as { _all: number } | undefined)?._all ?? 0;
    const present = count(attendance, 'PRESENT');
    const late = count(attendance, 'LATE');
    const confirmed = count(statusCounts, 'CONFIRMED');
    const locCount = new Map(byLocation.map((r) => [r.location_id, Number(r.n)]));
    return {
      event: { id: e.id, code: e.code, titleTh: e.titleTh, startAt: e.startAt, endAt: e.endAt, isOpen: this.isOpen(e, new Date()) },
      confirmed,
      pendingPayment: count(statusCounts, 'PENDING_PAYMENT'),
      checkedIn: present + late,
      late,
      excused: count(attendance, 'EXCUSED'),
      notArrived: Math.max(0, confirmed - present - late),
      byLocation: [
        ...locations.map((l) => ({ id: l.id, name: l.nameTh, isActive: l.isActive, count: locCount.get(l.id) ?? 0 })),
        ...(locCount.get(null) ? [{ id: null, name: 'ไม่ระบุจุด', isActive: true, count: locCount.get(null)! }] : []),
      ],
      byParticipantType: byType.map((t) => ({ code: t.code, name: t.name, registered: Number(t.registered), present: Number(t.present) })),
      bySchedule: schedules.map((s) => ({ id: s.id, title: s.title, startAt: s.startAt, count: (bySchedule.find((b) => b.scheduleId === s.id)?._count as { _all: number } | undefined)?._all ?? 0 })),
      hourly: hourly.map((h) => ({ hour: h.hour, count: Number(h.n) })).reverse(),
      recent: recent.map((r) => this.recordDto(r)),
    };
  }

  /** Roster for offline scanning: token hashes let the device verify a QR without the network. */
  async offlinePack(eventId: string, user: AuthUser) {
    const e = await this.access.assert(user, 'checkin:create', eventId);
    const LIMIT = 10_000;
    const regs = await this.prisma.registration.findMany({
      where: { eventId, status: { in: QR_STATUSES } },
      select: {
        id: true, referenceNo: true, prefix: true, firstName: true, lastName: true, status: true, affiliation: true,
        participantType: { select: { nameTh: true } },
        group: { select: { groupNo: true } },
        attendance: { where: { scheduleId: null }, select: { status: true, firstCheckinAt: true } },
      },
      orderBy: { id: 'asc' },
      take: LIMIT + 1,
    });
    const slice = regs.slice(0, LIMIT);
    const tokens = await this.ensureTokens(eventId, slice.map((r) => r.id));
    return {
      generatedAt: new Date().toISOString(),
      truncated: regs.length > LIMIT,
      event: { id: e.id, titleTh: e.titleTh, opensAt: this.window(e).opensAt, closesAt: this.window(e).closesAt },
      registrants: slice.map((r) => ({
        id: r.id,
        referenceNo: r.referenceNo,
        fullName: `${r.prefix ?? ''}${r.firstName} ${r.lastName}`.trim(),
        status: r.status,
        participantType: r.participantType.nameTh,
        affiliation: r.affiliation,
        groupNo: r.group?.groupNo ?? null,
        tokenHash: hashToken(tokens.get(r.id)!),
        checkedInAt: r.attendance[0] && (PRESENT as readonly string[]).includes(r.attendance[0].status) ? r.attendance[0].firstCheckinAt : null,
      })),
    };
  }

  // ───────────── helpers ─────────────

  window(e: Pick<ScopedEvent, 'startAt' | 'endAt' | 'checkinOpensBeforeMinutes'>) {
    return { opensAt: new Date(e.startAt.getTime() - e.checkinOpensBeforeMinutes * 60_000), closesAt: e.endAt };
  }

  private isOpen(e: ScopedEvent, at: Date) {
    const w = this.window(e);
    return CHECKIN_EVENT_STATUSES.includes(e.status) && at >= w.opensAt && at <= w.closesAt;
  }

  private assertCanCheckIn(e: ScopedEvent, status: RegistrationStatus, at: Date, who: RegistrantSummary) {
    const details = { registration: who };
    if (!CHECKIN_EVENT_STATUSES.includes(e.status)) {
      throw new AppError('EVENT_NOT_ACTIVE', 'กิจกรรมนี้ไม่อยู่ในสถานะที่เช็กอินได้', HttpStatus.CONFLICT, details);
    }
    const w = this.window(e);
    if (at < w.opensAt) throw new AppError('CHECKIN_NOT_OPEN', 'ยังไม่ถึงเวลาเปิดเช็กอิน', HttpStatus.CONFLICT, { ...details, opensAt: w.opensAt });
    if (at > w.closesAt) throw new AppError('CHECKIN_CLOSED', 'สิ้นสุดเวลาเช็กอินแล้ว', HttpStatus.CONFLICT, { ...details, closesAt: w.closesAt });
    if (status === 'PENDING_PAYMENT') {
      throw new AppError('PAYMENT_PENDING', 'ยังไม่ได้ชำระค่าลงทะเบียน กรุณาติดต่อจุดรับชำระเงิน', HttpStatus.CONFLICT, details);
    }
    if (status === 'WAITLISTED') throw new AppError('NOT_CONFIRMED', 'อยู่ในรายชื่อสำรอง ยังไม่ได้รับสิทธิ์เข้าร่วม', HttpStatus.CONFLICT, details);
    if (status !== 'CONFIRMED') throw new AppError('REGISTRATION_INACTIVE', 'การลงทะเบียนนี้ถูกยกเลิกหรือหมดอายุแล้ว', HttpStatus.CONFLICT, details);
  }

  /** Resolves the desk's location / session. A location's session applies unless one is given. */
  private async point(e: ScopedEvent, dto: { locationId?: string; scheduleId?: string; action?: 'CHECK_IN' | 'CHECK_OUT'; clientKey?: string }, method: CheckinMethod, occurredAt = new Date()): Promise<Point> {
    let scheduleId = dto.scheduleId ?? null;
    if (dto.locationId) {
      const loc = await this.prisma.checkinLocation.findUnique({ where: { id: dto.locationId } });
      if (!loc || loc.eventId !== e.id) throw Errors.validation('จุดเช็กอินไม่ถูกต้อง');
      if (!loc.isActive && method !== 'OFFLINE') throw Errors.invalidState('จุดเช็กอินนี้ปิดใช้งานแล้ว');
      scheduleId ??= loc.scheduleId;
    }
    if (scheduleId) await this.assertSchedule(e.id, scheduleId);
    return { locationId: dto.locationId ?? null, scheduleId, action: dto.action ?? 'CHECK_IN', method, occurredAt, clientKey: dto.clientKey };
  }

  private async assertSchedule(eventId: string, scheduleId: string) {
    const s = await this.prisma.eventSchedule.findUnique({ where: { id: scheduleId }, select: { eventId: true } });
    if (!s || s.eventId !== eventId) throw Errors.validation('ช่วงกิจกรรม (session) ไม่ถูกต้อง');
  }

  private duplicateName(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return Errors.conflict('DUPLICATE_NAME', 'มีจุดเช็กอินชื่อนี้แล้ว');
    return e;
  }

  private recordDto(r: {
    id: string; action: CheckinAction; method: CheckinMethod; occurredAt: Date; createdAt: Date; note: string | null; registrationId: string; undoesId: string | null;
    registration: { referenceNo: string; prefix: string | null; firstName: string; lastName: string };
    location: { nameTh: string } | null; schedule: { title: string } | null; actor: { displayName: string } | null;
    undoneBy: { id: string; createdAt: Date; note: string | null } | null;
  }) {
    return {
      id: r.id,
      action: r.action,
      method: r.method,
      occurredAt: r.occurredAt,
      createdAt: r.createdAt,
      note: r.note,
      registrationId: r.registrationId,
      referenceNo: r.registration.referenceNo,
      fullName: `${r.registration.prefix ?? ''}${r.registration.firstName} ${r.registration.lastName}`.trim(),
      location: r.location?.nameTh ?? null,
      schedule: r.schedule?.title ?? null,
      actor: r.actor?.displayName ?? null,
      undoesId: r.undoesId,
      undone: r.undoneBy ? { at: r.undoneBy.createdAt, reason: r.undoneBy.note } : null,
    };
  }
}
