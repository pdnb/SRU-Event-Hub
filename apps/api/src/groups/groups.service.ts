import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { EventGroupSettingDto, GroupChangeLogDto, GroupDetailDto, GroupMemberDto, GroupSummaryDto } from '@sru/shared-types';
import { randomBytes } from 'node:crypto';
import type { AuthUser } from '../auth/auth.types';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import type { RequestMeta } from '../common/decorators';
import { AppError, Errors } from '../common/errors';
import { moneyOut } from '../common/money';
import { Paginated } from '../common/pagination';
import { SequenceService } from '../common/sequence.service';
import { isRegistrationOpen } from '../events/event-state';
import { Prisma, RegistrationGroup, RegistrationGroupStatus, RegistrationStatus } from '../generated/prisma/client';
import { billingColumns } from '../payments/billing';
import { selectFeeRate } from '../payments/fee';
import { GroupOrderLineInput, LIVE_ORDER, PaymentsService, settlePayees } from '../payments/payments.service';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { FieldWithOptions, missingRequired, validateAnswers } from '../registrations/answers';
import { CONSENT_VERSION, Promotion, RegistrationsService } from '../registrations/registrations.service';
import { CreateGroupDto, GroupQueryDto, GroupSettingDto, MemberDto, SubmitGroupDto, UpdateGroupDto, UpdateMemberDto } from './groups.dto';

/** Members that count toward the group (hold or will hold a seat). */
export const MEMBER_STATUSES: RegistrationStatus[] = ['DRAFT', 'PENDING_PAYMENT', 'CONFIRMED'];
const SEATED: RegistrationStatus[] = ['PENDING_PAYMENT', 'CONFIRMED'];
const SUBMITTED: RegistrationGroupStatus[] = ['PENDING_PAYMENT', 'CONFIRMED'];
const OPEN_GROUP: RegistrationGroupStatus[] = ['DRAFT', 'PENDING_PAYMENT', 'CONFIRMED'];

export const DEFAULT_GROUP_SETTING = {
  isEnabled: false,
  minMembers: 2,
  maxMembers: 50,
  maxGroupsPerOrganization: null,
  allowImport: true,
  allowInviteLinks: true,
  memberChangeCloseAt: null,
};

interface LockedEvent {
  id: string;
  organization_id: string;
  status: string;
  capacity: number | null;
  seats_taken: number;
  is_paid: boolean;
  start_at: Date;
  end_at: Date;
  payment_window_hours: number;
  bank_account_id: string | null;
  income_code_id: string | null;
  registration_open_at: Date | null;
  registration_close_at: Date | null;
  deleted_at: Date | null;
}

export type Actor = { user: AuthUser | null; via?: 'coordinator' | 'organizer' | 'invitation' };

const MEMBER_INCLUDE = {
  participantType: { select: { code: true, nameTh: true } },
  answers: { include: { field: { select: { key: true, fieldType: true } }, option: { select: { value: true } } } },
  orderLines: { include: { order: { select: { status: true, groupId: true } } } },
} satisfies Prisma.RegistrationInclude;
type MemberRow = Prisma.RegistrationGetPayload<{ include: typeof MEMBER_INCLUDE }>;

const draftRef = () => `DRAFT-${randomBytes(9).toString('hex').toUpperCase()}`;
const isDraftRef = (ref: string) => ref.startsWith('DRAFT-');

/**
 * Group registration (spec §4.6.1).
 *
 * Lock order (shared with payments/expiry): registration_groups → events → payment_orders → payments.
 * Seats: a DRAFT group holds none; submit reserves `n = members` seats in one UPDATE under the event
 * row lock (all-or-nothing – a group is never partially seated or waitlisted). Member changes after
 * submission re-issue the combined order (amounts are immutable, so the old order is cancelled and
 * a new one with the same deadline is created); paid groups can only substitute members.
 */
@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly seq: SequenceService,
    private readonly payments: PaymentsService,
    private readonly regs: RegistrationsService,
  ) {}

  // ───────────── Event settings ─────────────

  async settings(eventId: string): Promise<EventGroupSettingDto> {
    const s = await this.prisma.eventGroupSetting.findUnique({ where: { eventId } });
    return this.settingDto(eventId, s);
  }

  async updateSettings(eventId: string, dto: GroupSettingDto, user: AuthUser, meta: RequestMeta) {
    const event = await this.prisma.event.findFirst({ where: { id: eventId, deletedAt: null } });
    if (!event) throw Errors.notFound('กิจกรรม');
    await this.access.assertOrg(user, 'group:update', event.organizationId);
    if (dto.maxMembers < dto.minMembers) throw Errors.validation('จำนวนสมาชิกสูงสุดต้องไม่น้อยกว่าขั้นต่ำ');
    if (event.capacity !== null && dto.minMembers > event.capacity) throw Errors.validation('จำนวนสมาชิกขั้นต่ำมากกว่าจำนวนที่นั่งของกิจกรรม');
    const closeAt = dto.memberChangeCloseAt ? new Date(dto.memberChangeCloseAt) : null;
    if (closeAt && closeAt > event.startAt) throw Errors.validation('กำหนดปิดแก้ไขรายชื่อต้องไม่เกินเวลาเริ่มกิจกรรม');
    const data = {
      isEnabled: dto.isEnabled,
      minMembers: dto.minMembers,
      maxMembers: dto.maxMembers,
      maxGroupsPerOrganization: dto.maxGroupsPerOrganization ?? null,
      allowImport: dto.allowImport,
      allowInviteLinks: dto.allowInviteLinks,
      memberChangeCloseAt: closeAt,
      updatedById: user.id,
    };
    const before = await this.prisma.eventGroupSetting.findUnique({ where: { eventId } });
    const s = await this.prisma.eventGroupSetting.upsert({ where: { eventId }, create: { eventId, ...data }, update: data });
    await this.audit.log({ actorId: user.id, action: 'event.group_settings', entityType: 'event', entityId: eventId, before, after: data, meta });
    return this.settingDto(eventId, s);
  }

  // ───────────── Coordinator: create / read / update ─────────────

  async create(eventId: string, dto: CreateGroupDto, user: AuthUser, meta: RequestMeta) {
    const coordinator = await this.prisma.organizationCoordinator.findUnique({
      where: { participantOrganizationId_userId: { participantOrganizationId: dto.participantOrganizationId, userId: user.id } },
      include: { participantOrganization: true },
    });
    if (!coordinator || coordinator.participantOrganization.deletedAt) throw Errors.forbidden('คุณไม่ได้เป็นผู้ประสานงานขององค์กรนี้');

    const group = await this.prisma.$transaction(async (tx) => {
      const ev = await this.lockEvent(tx, eventId);
      this.assertOpen(ev);
      const s = await this.requireEnabled(tx, eventId);
      if (s.maxGroupsPerOrganization) {
        const n = await tx.registrationGroup.count({ where: { eventId, participantOrganizationId: dto.participantOrganizationId, status: { in: OPEN_GROUP } } });
        if (n >= s.maxGroupsPerOrganization) {
          throw Errors.conflict('GROUP_LIMIT', `องค์กรนี้ลงทะเบียนกลุ่มในกิจกรรมนี้ได้สูงสุด ${s.maxGroupsPerOrganization} กลุ่ม`);
        }
      }
      const g = await tx.registrationGroup.create({
        data: {
          groupNo: await this.seq.next(tx, 'GRP'),
          eventId,
          participantOrganizationId: dto.participantOrganizationId,
          coordinatorUserId: user.id,
          name: dto.name,
          contactPhone: dto.contactPhone || coordinator.phone || null,
          note: dto.note || null,
        },
      });
      await this.log(tx, g.id, 'group.create', user.id, { after: { groupNo: g.groupNo, name: g.name } });
      await this.audit.log({ actorId: user.id, action: 'group.create', entityType: 'registration_group', entityId: g.id, after: { groupNo: g.groupNo, eventId }, meta }, tx);
      return g;
    });
    return this.detail(group.id, user);
  }

  async mine(user: AuthUser): Promise<GroupSummaryDto[]> {
    const rows = await this.prisma.registrationGroup.findMany({
      where: { coordinatorUserId: user.id },
      include: this.summaryInclude(),
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return Promise.all(rows.map((g) => this.summaryDto(g)));
  }

  async listForEvent(eventId: string, q: GroupQueryDto, user: AuthUser) {
    const event = await this.prisma.event.findFirst({ where: { id: eventId, deletedAt: null } });
    if (!event) throw Errors.notFound('กิจกรรม');
    await this.access.assertOrg(user, 'group:view', event.organizationId);
    const where: Prisma.RegistrationGroupWhereInput = {
      eventId,
      // Drafts are the coordinator's working copy – organizers see them only when filtering explicitly.
      status: q.status ?? { not: 'DRAFT' },
      ...(q.search
        ? {
            OR: [
              { groupNo: q.search.toUpperCase() },
              { name: { contains: q.search, mode: 'insensitive' } },
              { participantOrganization: { nameTh: { contains: q.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total, counts] = await this.prisma.$transaction([
      this.prisma.registrationGroup.findMany({ where, include: this.summaryInclude(), orderBy: { createdAt: q.order }, skip: q.skip, take: q.perPage }),
      this.prisma.registrationGroup.count({ where }),
      this.prisma.registrationGroup.groupBy({ by: ['status'], where: { eventId }, _count: { _all: true }, orderBy: { status: 'asc' } }),
    ]);
    const page = Paginated.of(await Promise.all(rows.map((g) => this.summaryDto(g))), total, q);
    return Object.assign(page, {
      meta: { ...page.meta, statusCounts: Object.fromEntries(counts.map((c) => [c.status, (c._count as { _all: number })._all])) },
    });
  }

  async detail(groupId: string, user: AuthUser): Promise<GroupDetailDto> {
    await this.loadForView(groupId, user);
    return this.buildDetail(groupId);
  }

  async update(groupId: string, dto: UpdateGroupDto, user: AuthUser, meta: RequestMeta) {
    const g = await this.loadForCoordinator(groupId, user);
    if (!OPEN_GROUP.includes(g.status)) throw Errors.invalidState('กลุ่มนี้ถูกยกเลิกหรือหมดเวลาแล้ว');
    const data = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone || null } : {}),
      ...(dto.note !== undefined ? { note: dto.note || null } : {}),
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.registrationGroup.update({ where: { id: groupId }, data: { ...data, version: { increment: 1 } } });
      await this.log(tx, groupId, 'group.update', user.id, { before: { name: g.name, contactPhone: g.contactPhone, note: g.note }, after: data });
    });
    await this.audit.log({ actorId: user.id, action: 'group.update', entityType: 'registration_group', entityId: groupId, after: data, meta });
    return this.buildDetail(groupId);
  }

  async changeLogs(groupId: string, user: AuthUser): Promise<GroupChangeLogDto[]> {
    await this.loadForView(groupId, user);
    const rows = await this.prisma.groupChangeLog.findMany({ where: { groupId }, orderBy: { createdAt: 'desc' }, take: 500 });
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
    const actors = new Map((await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true } })).map((u) => [u.id, u.displayName]));
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      registrationId: r.registrationId,
      before: r.before,
      after: r.after,
      reason: r.reason,
      actorName: r.actorId ? (actors.get(r.actorId) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // ───────────── Members ─────────────

  async addMemberByCoordinator(groupId: string, dto: MemberDto, user: AuthUser, meta: RequestMeta) {
    await this.loadForCoordinator(groupId, user);
    const res = await this.addMember(groupId, dto, user.id, meta);
    return { memberId: res.id, group: await this.buildDetail(groupId) };
  }

  /**
   * Adds one member. DRAFT group: a DRAFT row (no seat). Submitted group (unpaid or free event): a
   * seat is reserved now and the combined order is re-issued with the new total.
   */
  async addMember(groupId: string, dto: MemberDto, actorId: string | null, meta: RequestMeta, opts: { tx?: Tx; selfConsent?: boolean } = {}) {
    const fields = await this.fields(groupId);
    const answers = validateAnswers(fields, dto.answers ?? [], { requireAll: false });
    const pt = await this.participantTypeFor(groupId, dto.participantTypeCode);
    const run = async (tx: Tx) => {
      const g = await this.lockGroup(tx, groupId);
      if (!OPEN_GROUP.includes(g.status)) throw Errors.invalidState('กลุ่มนี้ถูกยกเลิกหรือหมดเวลาแล้ว');
      const ev = await this.lockEvent(tx, g.eventId);
      const s = await this.requireEnabled(tx, g.eventId);
      const count = await tx.registration.count({ where: { groupId, status: { in: MEMBER_STATUSES } } });
      if (count >= s.maxMembers) throw Errors.conflict('GROUP_FULL', `กลุ่มมีสมาชิกได้สูงสุด ${s.maxMembers} คน`);
      await this.assertEmailFree(tx, g, dto.email);

      const submitted = SUBMITTED.includes(g.status);
      const now = new Date();
      let status: RegistrationStatus = 'DRAFT';
      if (submitted) {
        this.assertCanChange(g, s, ev, now);
        await this.assertOrderChangeable(tx, groupId, ev);
        if (ev.capacity !== null && ev.seats_taken + 1 > ev.capacity) throw Errors.conflict('EVENT_FULL', 'ที่นั่งเต็มแล้ว เพิ่มสมาชิกไม่ได้');
        await tx.$executeRaw`UPDATE events SET seats_taken = seats_taken + 1 WHERE id = ${g.eventId}::uuid`;
        status = g.status === 'CONFIRMED' && !ev.is_paid ? 'CONFIRMED' : 'PENDING_PAYMENT';
      } else {
        this.assertOpen(ev);
      }
      const reg = await tx.registration.create({
        data: {
          ...this.memberColumns(dto),
          eventId: g.eventId,
          groupId,
          referenceNo: submitted ? await this.seq.next(tx, 'REG') : draftRef(),
          participantTypeId: pt.id,
          status,
          source: 'GROUP',
          consentAt: now,
          consentVersion: CONSENT_VERSION,
          confirmedAt: status === 'CONFIRMED' ? now : null,
          createdById: actorId,
          answers: { create: answers },
        },
      });
      if (opts.selfConsent) {
        await tx.groupConsent.create({ data: { groupId, registrationId: reg.id, consentType: 'MEMBER', consentVersion: CONSENT_VERSION, userId: actorId, ip: meta.ip, userAgent: meta.userAgent } });
      }
      await this.log(tx, groupId, 'member.add', actorId, { registrationId: reg.id, after: this.memberSnapshot(reg) });
      let order: { id: string; dueAt: Date } | null = null;
      if (submitted && ev.is_paid) order = await this.reissueOrder(tx, g, ev, now, actorId, 'เพิ่มสมาชิก');
      return { reg, order };
    };
    try {
      const { reg, order } = opts.tx ? await run(opts.tx) : await this.prisma.$transaction(run, { timeout: 15_000 });
      if (order) this.payments.scheduleExpiry(order);
      return reg;
    } catch (e) {
      throw this.mapDuplicate(e);
    }
  }

  /**
   * Edit / substitute a member (เปลี่ยนตัว). After submission the seat and fee line stay with the
   * row; the participant type cannot change then (it would change the fee).
   */
  async updateMember(groupId: string, regId: string, dto: UpdateMemberDto, actorId: string | null, meta: RequestMeta, opts: { asCoordinator?: AuthUser; selfConsent?: boolean } = {}) {
    if (opts.asCoordinator) await this.loadForCoordinator(groupId, opts.asCoordinator);
    const fields = await this.fields(groupId);
    const answers = validateAnswers(fields, dto.answers ?? [], { requireAll: false });
    const pt = await this.participantTypeFor(groupId, dto.participantTypeCode);
    try {
      await this.prisma.$transaction(async (tx) => {
        const g = await this.lockGroup(tx, groupId);
        if (!OPEN_GROUP.includes(g.status)) throw Errors.invalidState('กลุ่มนี้ถูกยกเลิกหรือหมดเวลาแล้ว');
        const reg = await tx.registration.findFirst({ where: { id: regId, groupId, status: { in: MEMBER_STATUSES } } });
        if (!reg) throw Errors.notFound('สมาชิกในกลุ่ม');
        const submitted = SUBMITTED.includes(g.status);
        if (submitted) {
          const ev = await this.lockEvent(tx, g.eventId);
          const s = await this.requireEnabled(tx, g.eventId);
          this.assertCanChange(g, s, ev, new Date());
          if (pt.id !== reg.participantTypeId) throw Errors.invalidState('เปลี่ยนประเภทผู้เข้าร่วมหลังส่งกลุ่มแล้วไม่ได้ (มีผลต่อค่าลงทะเบียน) — ให้ลบและเพิ่มสมาชิกใหม่แทน');
          if (opts.asCoordinator && !dto.reason?.trim()) throw Errors.validation('กรุณาระบุเหตุผลการแก้ไข/เปลี่ยนตัวสมาชิก');
        }
        if (reg.emailNormalized !== dto.email.trim().toLowerCase()) await this.assertEmailFree(tx, g, dto.email, reg.id);
        await tx.registrationAnswer.deleteMany({ where: { registrationId: regId } });
        const updated = await tx.registration.update({
          where: { id: regId },
          data: { ...this.memberColumns(dto), participantTypeId: pt.id, version: { increment: 1 }, answers: { create: answers } },
        });
        if (opts.selfConsent) {
          await tx.groupConsent.create({ data: { groupId, registrationId: regId, consentType: 'MEMBER', consentVersion: CONSENT_VERSION, userId: actorId, ip: meta.ip, userAgent: meta.userAgent } });
        }
        const substituted = reg.emailNormalized !== updated.emailNormalized;
        await this.log(tx, groupId, substituted && submitted ? 'member.substitute' : 'member.update', actorId, {
          registrationId: regId,
          before: this.memberSnapshot(reg),
          after: this.memberSnapshot(updated),
          reason: dto.reason?.trim() || null,
        });
        await this.audit.log({ actorId, action: 'group.member_update', entityType: 'registration', entityId: regId, before: this.memberSnapshot(reg), after: this.memberSnapshot(updated), reason: dto.reason, meta }, tx);
      });
    } catch (e) {
      throw this.mapDuplicate(e);
    }
    return this.buildDetail(groupId);
  }

  /** DRAFT: the row is deleted. Submitted (unpaid / free): seat released + order re-issued. */
  async removeMember(groupId: string, regId: string, reason: string | undefined, user: AuthUser, meta: RequestMeta) {
    await this.loadForCoordinator(groupId, user);
    let promotion: Promotion = { promoted: [], orders: [] };
    let order: { id: string; dueAt: Date } | null = null;
    await this.prisma.$transaction(async (tx) => {
      const g = await this.lockGroup(tx, groupId);
      const reg = await tx.registration.findFirst({ where: { id: regId, groupId, status: { in: MEMBER_STATUSES } } });
      if (!reg) throw Errors.notFound('สมาชิกในกลุ่ม');
      if (g.status === 'DRAFT') {
        await tx.registration.delete({ where: { id: regId } });
        await this.log(tx, groupId, 'member.remove', user.id, { registrationId: regId, before: this.memberSnapshot(reg), reason: reason ?? null });
        return;
      }
      if (!SUBMITTED.includes(g.status)) throw Errors.invalidState('กลุ่มนี้ถูกยกเลิกหรือหมดเวลาแล้ว');
      if (!reason?.trim()) throw Errors.validation('กรุณาระบุเหตุผลการถอนสมาชิก');
      const ev = await this.lockEvent(tx, g.eventId);
      const s = await this.requireEnabled(tx, g.eventId);
      const now = new Date();
      this.assertCanChange(g, s, ev, now);
      await this.assertOrderChangeable(tx, groupId, ev);
      const remaining = await tx.registration.count({ where: { groupId, status: { in: SEATED }, id: { not: regId } } });
      if (remaining < s.minMembers) throw Errors.invalidState(`กลุ่มต้องมีสมาชิกอย่างน้อย ${s.minMembers} คน — หากต้องการถอนทั้งหมดให้ยกเลิกกลุ่ม`);

      await tx.registration.update({ where: { id: regId }, data: { status: 'CANCELLED', cancelledAt: now, cancelReason: reason, version: { increment: 1 } } });
      await tx.$executeRaw`UPDATE events SET seats_taken = seats_taken - ${reg.seats} WHERE id = ${g.eventId}::uuid`;
      await this.log(tx, groupId, 'member.remove', user.id, { registrationId: regId, before: this.memberSnapshot(reg), reason });
      if (ev.is_paid) order = await this.reissueOrder(tx, g, ev, now, user.id, 'ถอนสมาชิก');
      promotion = await this.regs.promoteWaitlist(tx, g.eventId);
      await this.audit.log({ actorId: user.id, action: 'group.member_remove', entityType: 'registration', entityId: regId, reason, meta }, tx);
    }, { timeout: 15_000 });
    if (order) this.payments.scheduleExpiry(order);
    promotion.orders.forEach((o) => this.payments.scheduleExpiry(o));
    return this.buildDetail(groupId);
  }

  // ───────────── Submit (atomic seat reservation) ─────────────

  async submit(groupId: string, dto: SubmitGroupDto, user: AuthUser, meta: RequestMeta) {
    await this.loadForCoordinator(groupId, user);
    const fields = await this.fields(groupId);
    const billing = dto.billing ? billingColumns(dto.billing) : undefined;
    let order: { id: string; dueAt: Date } | null = null;
    try {
      await this.prisma.$transaction(async (tx) => {
        const g = await this.lockGroup(tx, groupId);
        if (g.status !== 'DRAFT') throw Errors.invalidState('กลุ่มนี้ส่งไปแล้ว');
        const ev = await this.lockEvent(tx, g.eventId);
        this.assertOpen(ev);
        const s = await this.requireEnabled(tx, g.eventId);
        const members = await tx.registration.findMany({
          where: { groupId, status: 'DRAFT' },
          include: { answers: { select: { fieldId: true } }, participantType: { select: { nameTh: true } } },
          orderBy: { createdAt: 'asc' },
        });
        const n = members.length;
        if (n < s.minMembers || n > s.maxMembers) {
          throw Errors.validation(`กลุ่มต้องมีสมาชิก ${s.minMembers}–${s.maxMembers} คน (ปัจจุบัน ${n} คน)`);
        }
        // Every member complete (required questions) – reported together so the coordinator can fix all at once.
        const incomplete: Record<string, string> = {};
        for (const m of members) {
          const missing = missingRequired(fields, new Set(m.answers.map((a) => a.fieldId)));
          if (missing.length) incomplete[m.email] = `ยังไม่ได้กรอก: ${missing.join(', ')}`;
        }
        if (Object.keys(incomplete).length) throw Errors.validation('ข้อมูลสมาชิกยังไม่ครบ', incomplete);
        // Already registered in this event (individually or in another group).
        const dup = await tx.registration.findMany({
          where: { eventId: g.eventId, status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'WAITLISTED'] }, emailNormalized: { in: members.map((m) => m.emailNormalized) } },
          select: { email: true },
        });
        if (dup.length) {
          throw new AppError('DUPLICATE_REGISTRATION', 'มีสมาชิกที่ลงทะเบียนกิจกรรมนี้ไว้แล้ว', HttpStatus.CONFLICT, { emails: dup.map((d) => d.email) });
        }
        // All-or-nothing seat reservation.
        if (ev.capacity !== null && ev.seats_taken + n > ev.capacity) {
          const available = Math.max(0, ev.capacity - ev.seats_taken);
          throw new AppError('GROUP_SEATS_UNAVAILABLE', `ที่นั่งคงเหลือ ${available} ที่ ไม่พอสำหรับสมาชิก ${n} คน`, HttpStatus.CONFLICT, { available, requested: n });
        }
        const now = new Date();
        const lines = ev.is_paid ? await this.feeLines(tx, g.eventId, members, now) : [];
        const total = lines.reduce((sum, l) => sum.plus(l.amount), new Prisma.Decimal(0));
        const paid = total.gt(0);

        await tx.$executeRaw`UPDATE events SET seats_taken = seats_taken + ${n} WHERE id = ${g.eventId}::uuid`;
        const status: RegistrationStatus = paid ? 'PENDING_PAYMENT' : 'CONFIRMED';
        for (const m of members) {
          await tx.registration.update({
            where: { id: m.id },
            data: { referenceNo: await this.seq.next(tx, 'REG'), status, confirmedAt: paid ? null : now, version: { increment: 1 } },
          });
        }
        await tx.registrationGroup.update({
          where: { id: groupId },
          data: { status: paid ? 'PENDING_PAYMENT' : 'CONFIRMED', submittedAt: now, confirmedAt: paid ? null : now, version: { increment: 1 } },
        });
        if (paid) {
          const org = await tx.participantOrganization.findUniqueOrThrow({ where: { id: g.participantOrganizationId } });
          const coordinator = await tx.user.findUniqueOrThrow({ where: { id: g.coordinatorUserId }, select: { email: true } });
          const defaultBilling =
            org.taxId && org.address
              ? { billingType: 'JURISTIC' as const, billingName: org.nameTh, billingTaxId: org.taxId, billingBranch: org.branch ?? '00000', billingAddress: org.address }
              : undefined;
          order = await this.payments.createGroupOrder(
            tx,
            { id: groupId, eventId: g.eventId, payerName: org.nameTh, payerEmail: coordinator.email },
            lines,
            this.regs.eventForOrder(ev),
            now,
            { billing: billing ?? defaultBilling },
          );
          if (order) await tx.registration.updateMany({ where: { groupId, status: 'PENDING_PAYMENT' }, data: { paymentDueAt: order.dueAt } });
        }
        await tx.groupConsent.create({
          data: { groupId, consentType: 'COORDINATOR_ATTESTATION', consentVersion: CONSENT_VERSION, memberCount: n, userId: user.id, ip: meta.ip, userAgent: meta.userAgent },
        });
        await this.log(tx, groupId, 'group.submit', user.id, { after: { members: n, total: total.toFixed(2), status } });
        await this.audit.log({ actorId: user.id, action: 'group.submit', entityType: 'registration_group', entityId: groupId, after: { members: n, total: total.toFixed(2) }, meta }, tx);
      }, { timeout: 30_000 });
    } catch (e) {
      throw this.mapDuplicate(e);
    }
    if (order) this.payments.scheduleExpiry(order);
    return this.buildDetail(groupId);
  }

  // ───────────── Cancel ─────────────

  /** Coordinator, or an organizer with group:update. Paid orders go to REFUND_PENDING (refund process). */
  async cancel(groupId: string, reason: string | undefined, user: AuthUser, meta: RequestMeta) {
    const g0 = await this.loadForView(groupId, user, 'group:update');
    if (g0.coordinatorUserId !== user.id && !reason?.trim()) throw Errors.validation('กรุณาระบุเหตุผลการยกเลิก');
    const why = reason?.trim() || 'ผู้ประสานงานยกเลิกกลุ่ม';
    let promotion: Promotion = { promoted: [], orders: [] };
    await this.prisma.$transaction(async (tx) => {
      const g = await this.lockGroup(tx, groupId);
      if (!OPEN_GROUP.includes(g.status)) throw Errors.invalidState('กลุ่มนี้ถูกยกเลิกหรือหมดเวลาแล้ว');
      await this.lockEvent(tx, g.eventId);
      const now = new Date();
      const members = await tx.registration.findMany({ where: { groupId, status: { in: MEMBER_STATUSES } }, select: { id: true, status: true, seats: true } });
      const seats = members.filter((m) => SEATED.includes(m.status)).reduce((sum, m) => sum + m.seats, 0);
      await tx.registration.updateMany({
        where: { id: { in: members.map((m) => m.id) } },
        data: { status: 'CANCELLED', cancelledAt: now, cancelReason: why, version: { increment: 1 } },
      });
      await tx.registrationGroup.update({ where: { id: groupId }, data: { status: 'CANCELLED', cancelledAt: now, cancelReason: why, version: { increment: 1 } } });
      await tx.groupMemberInvitation.updateMany({ where: { groupId, revokedAt: null }, data: { revokedAt: now } });
      await this.payments.closeOrders(tx, { registrationId: null, groupId }, why, user.id);
      if (seats) {
        await tx.$executeRaw`UPDATE events SET seats_taken = seats_taken - ${seats} WHERE id = ${g.eventId}::uuid`;
        promotion = await this.regs.promoteWaitlist(tx, g.eventId);
      }
      await this.log(tx, groupId, 'group.cancel', user.id, { before: { status: g.status }, after: { status: 'CANCELLED', members: members.length, seatsReleased: seats }, reason: why });
      await this.audit.log({ actorId: user.id, action: 'group.cancel', entityType: 'registration_group', entityId: groupId, before: { status: g.status }, after: { status: 'CANCELLED' }, reason: why, meta }, tx);
    }, { timeout: 15_000 });
    promotion.orders.forEach((o) => this.payments.scheduleExpiry(o));
    return this.buildDetail(groupId);
  }

  // ───────────── Payment (combined order) ─────────────

  async liveOrderId(groupId: string, user: AuthUser) {
    await this.loadForCoordinator(groupId, user);
    const o = await this.prisma.paymentOrder.findFirst({ where: { groupId, status: { notIn: ['CANCELLED', 'EXPIRED'] } }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (!o) throw Errors.invalidState('กลุ่มนี้ไม่มีรายการที่ต้องชำระ');
    return o.id;
  }

  // ───────────── Access helpers ─────────────

  /** Only the coordinator who owns the group. */
  async loadForCoordinator(groupId: string, user: AuthUser) {
    const g = await this.prisma.registrationGroup.findUnique({ where: { id: groupId } });
    if (!g) throw Errors.notFound('กลุ่ม');
    if (g.coordinatorUserId !== user.id) throw Errors.forbidden('เฉพาะผู้ประสานงานของกลุ่มนี้');
    return g;
  }

  /** Coordinator, or an organizer holding `perm` on the event's organization. */
  async loadForView(groupId: string, user: AuthUser, perm: 'group:view' | 'group:update' = 'group:view') {
    const g = await this.prisma.registrationGroup.findUnique({ where: { id: groupId }, include: { event: { select: { organizationId: true } } } });
    if (!g) throw Errors.notFound('กลุ่ม');
    if (g.coordinatorUserId === user.id) return g;
    await this.access.assertOrg(user, perm, g.event.organizationId);
    return g;
  }

  // ───────────── internals ─────────────

  private async lockGroup(tx: Tx, id: string): Promise<RegistrationGroup> {
    await tx.$queryRaw`SELECT id FROM registration_groups WHERE id = ${id}::uuid FOR UPDATE`;
    const g = await tx.registrationGroup.findUnique({ where: { id } });
    if (!g) throw Errors.notFound('กลุ่ม');
    return g;
  }

  private async lockEvent(tx: Tx, eventId: string): Promise<LockedEvent> {
    const [ev] = await tx.$queryRaw<LockedEvent[]>`
      SELECT id::text, organization_id::text, status::text, capacity, seats_taken, is_paid, start_at, end_at, payment_window_hours,
             bank_account_id::text, income_code_id::text, registration_open_at, registration_close_at, deleted_at
      FROM events WHERE id = ${eventId}::uuid FOR UPDATE`;
    if (!ev || ev.deleted_at) throw Errors.notFound('กิจกรรม');
    return ev;
  }

  private assertOpen(ev: LockedEvent) {
    const open = isRegistrationOpen({
      status: ev.status as never,
      registrationOpenAt: ev.registration_open_at,
      registrationCloseAt: ev.registration_close_at,
      endAt: ev.end_at,
    });
    if (!open) throw new AppError('REGISTRATION_CLOSED', 'กิจกรรมนี้ยังไม่เปิดหรือปิดรับสมัครแล้ว', HttpStatus.CONFLICT);
  }

  private async requireEnabled(tx: Tx, eventId: string) {
    const s = await tx.eventGroupSetting.findUnique({ where: { eventId } });
    if (!s?.isEnabled) throw Errors.conflict('GROUP_DISABLED', 'กิจกรรมนี้ไม่เปิดรับการลงทะเบียนแบบกลุ่ม');
    return s;
  }

  changeCloseAt(s: { memberChangeCloseAt: Date | null }, eventStart: Date) {
    return s.memberChangeCloseAt && s.memberChangeCloseAt < eventStart ? s.memberChangeCloseAt : eventStart;
  }

  private assertCanChange(g: RegistrationGroup, s: { memberChangeCloseAt: Date | null }, ev: LockedEvent, now: Date) {
    if (!SUBMITTED.includes(g.status)) throw Errors.invalidState('กลุ่มนี้ถูกยกเลิกหรือหมดเวลาแล้ว');
    if (now >= this.changeCloseAt(s, ev.start_at)) throw Errors.invalidState('เลยกำหนดแก้ไขรายชื่อสมาชิกแล้ว');
  }

  /** Adding / removing after submission is allowed only while nothing has been paid (or the event is free). */
  private async assertOrderChangeable(tx: Tx, groupId: string, ev: LockedEvent) {
    if (!ev.is_paid) return;
    // Lock first: a slip may be landing on this order concurrently (submitSlip locks the order row).
    await tx.$queryRaw`SELECT id FROM payment_orders WHERE group_id = ${groupId}::uuid AND status::text IN ('UNPAID', 'PENDING_VERIFICATION', 'PAID', 'WAIVED') FOR UPDATE`;
    const o = await tx.paymentOrder.findFirst({ where: { groupId, status: { in: [...LIVE_ORDER, 'PAID', 'WAIVED'] } }, select: { status: true } });
    if (o?.status === 'PENDING_VERIFICATION') throw Errors.invalidState('มีหลักฐานการชำระเงินรอตรวจสอบอยู่ กรุณารอผลการตรวจสอบก่อนเพิ่ม/ถอนสมาชิก');
    if (o && o.status !== 'UNPAID') {
      throw Errors.invalidState('กลุ่มชำระเงินแล้ว เพิ่ม/ถอนสมาชิกไม่ได้ (เปลี่ยนตัวสมาชิกได้ หรือสร้างกลุ่มใหม่สำหรับผู้เข้าร่วมเพิ่ม)');
    }
  }

  /**
   * Cancels the live UNPAID order and issues a new one for the current members. Existing members
   * keep their fee snapshot; new members get the rate valid now. Deadline is kept (never extended).
   * Total 0 → no order; the group is confirmed.
   */
  private async reissueOrder(tx: Tx, g: RegistrationGroup, ev: LockedEvent, now: Date, actorId: string | null, why: string) {
    await tx.$queryRaw`SELECT id FROM payment_orders WHERE group_id = ${g.id}::uuid AND status::text = 'UNPAID' FOR UPDATE`;
    const old = await tx.paymentOrder.findFirst({ where: { groupId: g.id, status: 'UNPAID' }, include: { lines: true } });
    const members = await tx.registration.findMany({ where: { groupId: g.id, status: { in: SEATED } }, orderBy: { createdAt: 'asc' } });
    const prior = new Map(old?.lines.map((l) => [l.registrationId, l]) ?? []);
    const fresh = await this.feeLines(tx, g.eventId, members.filter((m) => !prior.has(m.id)), now);
    const lines: GroupOrderLineInput[] = members.map((m) => {
      const p = prior.get(m.id);
      return p ? { registrationId: m.id, feeRateId: p.feeRateId, feeName: p.feeName, amount: p.amount } : fresh.find((f) => f.registrationId === m.id)!;
    });
    if (old) {
      await tx.paymentOrder.update({ where: { id: old.id }, data: { status: 'CANCELLED', closedAt: now, closeReason: `ออกใบแจ้งชำระใหม่ (${why})`, version: { increment: 1 } } });
    }
    const org = await tx.participantOrganization.findUniqueOrThrow({ where: { id: g.participantOrganizationId } });
    const coordinator = await tx.user.findUniqueOrThrow({ where: { id: g.coordinatorUserId }, select: { email: true } });
    const keepBilling = old
      ? { billingType: old.billingType, billingName: old.billingName, billingTaxId: old.billingTaxId, billingBranch: old.billingBranch, billingAddress: old.billingAddress }
      : undefined;
    const order = await this.payments.createGroupOrder(
      tx,
      { id: g.id, eventId: g.eventId, payerName: org.nameTh, payerEmail: coordinator.email },
      lines,
      this.regs.eventForOrder(ev),
      now,
      { billing: keepBilling, dueAt: old?.dueAt },
    );
    if (order) {
      await tx.registration.updateMany({ where: { groupId: g.id, status: 'CONFIRMED' }, data: { status: 'PENDING_PAYMENT', confirmedAt: null, version: { increment: 1 } } });
      await tx.registration.updateMany({ where: { groupId: g.id, status: 'PENDING_PAYMENT' }, data: { paymentDueAt: order.dueAt } });
      await tx.registrationGroup.update({ where: { id: g.id }, data: { status: 'PENDING_PAYMENT', confirmedAt: null } });
    } else {
      await settlePayees(tx, { registrationId: null, groupId: g.id }, now);
    }
    await this.log(tx, g.id, 'order.reissue', actorId, {
      before: old ? { orderNo: old.orderNo, amount: old.amount.toFixed(2) } : null,
      after: order ? { orderNo: order.orderNo, amount: order.amount.toFixed(2) } : { amount: '0.00' },
      reason: why,
    });
    return order ? { id: order.id, dueAt: order.dueAt } : null;
  }

  /** Fee snapshot per member (rate by participant type valid at `at`). */
  private async feeLines(tx: Tx, eventId: string, members: { id: string; participantTypeId: string; email: string }[], at: Date): Promise<GroupOrderLineInput[]> {
    if (!members.length) return [];
    const rates = await tx.eventFeeRate.findMany({ where: { eventId, isActive: true } });
    const missing: string[] = [];
    const lines = members.map((m) => {
      const r = selectFeeRate(rates, m.participantTypeId, at);
      if (!r) missing.push(m.email);
      return { registrationId: m.id, feeRateId: r?.id ?? null, feeName: r?.nameTh ?? '', amount: r?.amount ?? new Prisma.Decimal(0) };
    });
    if (missing.length) {
      throw new AppError('FEE_NOT_AVAILABLE', 'ไม่มีอัตราค่าลงทะเบียนสำหรับประเภทผู้เข้าร่วมของสมาชิกบางคนในช่วงเวลานี้', HttpStatus.CONFLICT, { emails: missing });
    }
    return lines;
  }

  /** Same e-mail may not appear twice in a group, nor be registered in the event already. */
  private async assertEmailFree(tx: Tx, g: RegistrationGroup, email: string, exceptId?: string) {
    const e = email.trim().toLowerCase();
    const inGroup = await tx.registration.count({ where: { groupId: g.id, emailNormalized: e, status: { in: MEMBER_STATUSES }, ...(exceptId ? { id: { not: exceptId } } : {}) } });
    if (inGroup) throw Errors.conflict('DUPLICATE_MEMBER', 'อีเมลนี้อยู่ในกลุ่มแล้ว');
    const inEvent = await tx.registration.count({
      where: { eventId: g.eventId, emailNormalized: e, status: { in: ['PENDING_PAYMENT', 'CONFIRMED', 'WAITLISTED'] }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (inEvent) throw Errors.conflict('DUPLICATE_REGISTRATION', 'อีเมลนี้ลงทะเบียนกิจกรรมนี้ไว้แล้ว');
  }

  private mapDuplicate(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new AppError('DUPLICATE_REGISTRATION', 'มีอีเมลของสมาชิกที่ลงทะเบียนกิจกรรมนี้ไว้แล้ว', HttpStatus.CONFLICT);
    }
    return e;
  }

  async fields(groupId: string): Promise<FieldWithOptions[]> {
    const g = await this.prisma.registrationGroup.findUnique({ where: { id: groupId }, select: { eventId: true } });
    if (!g) throw Errors.notFound('กลุ่ม');
    return this.prisma.registrationField.findMany({ where: { eventId: g.eventId, isActive: true }, include: { options: { orderBy: { sortOrder: 'asc' } } }, orderBy: { sortOrder: 'asc' } });
  }

  async participantTypeFor(groupId: string, code: string) {
    const g = await this.prisma.registrationGroup.findUnique({ where: { id: groupId }, select: { eventId: true } });
    if (!g) throw Errors.notFound('กลุ่ม');
    return this.regs.resolveParticipantType(g.eventId, code);
  }

  async participantTypes(eventId: string) {
    const allowed = await this.prisma.eventParticipantType.findMany({ where: { eventId }, include: { participantType: true } });
    const types = allowed.length ? allowed.map((a) => a.participantType) : await this.prisma.participantType.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
    return types.map((t) => ({ code: t.code, nameTh: t.nameTh }));
  }

  private memberColumns(dto: MemberDto) {
    return {
      prefix: dto.prefix?.trim() || null,
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      email: dto.email.trim(),
      emailNormalized: dto.email.trim().toLowerCase(),
      phone: dto.phone || null,
      studentOrStaffCode: dto.studentOrStaffCode?.trim() || null,
      affiliation: dto.affiliation?.trim() || null,
      program: dto.program?.trim() || null,
    };
  }

  private memberSnapshot(r: { prefix: string | null; firstName: string; lastName: string; email: string; phone: string | null; participantTypeId: string; referenceNo: string }) {
    return {
      referenceNo: isDraftRef(r.referenceNo) ? null : r.referenceNo,
      name: `${r.prefix ?? ''}${r.firstName} ${r.lastName}`.trim(),
      email: r.email,
      phone: r.phone,
      participantTypeId: r.participantTypeId,
    };
  }

  async log(
    tx: Tx,
    groupId: string,
    action: string,
    actorId: string | null,
    d: { registrationId?: string; before?: unknown; after?: unknown; reason?: string | null } = {},
  ) {
    const json = (v: unknown) => (v === undefined || v === null ? Prisma.DbNull : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue));
    await tx.groupChangeLog.create({
      data: { groupId, action, actorId, registrationId: d.registrationId ?? null, before: json(d.before), after: json(d.after), reason: d.reason ?? null },
    });
  }

  // ───────────── mapping ─────────────

  private summaryInclude() {
    return {
      event: { select: { id: true, code: true, titleTh: true, startAt: true } },
      participantOrganization: { select: { id: true, nameTh: true, verifiedAt: true } },
      coordinator: { select: { id: true, displayName: true, email: true } },
      _count: { select: { members: { where: { status: { in: MEMBER_STATUSES } } } } },
    } satisfies Prisma.RegistrationGroupInclude;
  }

  private async summaryDto(g: Prisma.RegistrationGroupGetPayload<{ include: ReturnType<GroupsService['summaryInclude']> }>): Promise<GroupSummaryDto> {
    const order = await this.prisma.paymentOrder.findFirst({
      where: { groupId: g.id },
      orderBy: { createdAt: 'desc' },
      include: { payments: { orderBy: { submittedAt: 'desc' }, take: 1 } },
    });
    return {
      id: g.id,
      groupNo: g.groupNo,
      name: g.name,
      status: g.status,
      eventId: g.event.id,
      eventCode: g.event.code,
      eventTitle: g.event.titleTh,
      eventStartAt: g.event.startAt.toISOString(),
      participantOrganization: { id: g.participantOrganization.id, nameTh: g.participantOrganization.nameTh, verified: !!g.participantOrganization.verifiedAt },
      coordinator: g.coordinator,
      contactPhone: g.contactPhone,
      memberCount: g._count.members,
      submittedAt: g.submittedAt?.toISOString() ?? null,
      confirmedAt: g.confirmedAt?.toISOString() ?? null,
      createdAt: g.createdAt.toISOString(),
      payment: order ? this.payments.orderDto(order) : null,
    };
  }

  async buildDetail(groupId: string): Promise<GroupDetailDto> {
    const g = await this.prisma.registrationGroup.findUniqueOrThrow({ where: { id: groupId }, include: this.summaryInclude() });
    const [summary, s, event, members, invitations, consents, fields, types] = await Promise.all([
      this.summaryDto(g),
      this.prisma.eventGroupSetting.findUnique({ where: { eventId: g.eventId } }),
      this.prisma.event.findUniqueOrThrow({ where: { id: g.eventId }, select: { isPaid: true, startAt: true } }),
      this.prisma.registration.findMany({
        where: { groupId, status: { in: g.status === 'CANCELLED' || g.status === 'EXPIRED' ? undefined : MEMBER_STATUSES } },
        include: MEMBER_INCLUDE,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.groupMemberInvitation.findMany({ where: { groupId }, include: { registration: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.groupConsent.findMany({ where: { groupId, consentType: 'MEMBER' }, select: { registrationId: true } }),
      this.fields(groupId),
      this.participantTypes(g.eventId),
    ]);
    const selfConsented = new Set(consents.map((c) => c.registrationId));
    const settings = this.settingDto(g.eventId, s);
    const now = new Date();
    const canChangeMembers =
      g.status === 'DRAFT' || (SUBMITTED.includes(g.status) && !!s?.isEnabled && now < this.changeCloseAt(s, event.startAt));
    return {
      ...summary,
      note: g.note,
      cancelReason: g.cancelReason,
      settings,
      canChangeMembers,
      isPaid: event.isPaid,
      members: members.map((m) => this.memberDto(m, selfConsented.has(m.id))),
      invitations: invitations.map((i) => ({
        id: i.id,
        registrationId: i.registrationId,
        memberName: i.registration ? `${i.registration.firstName} ${i.registration.lastName}` : null,
        maxUses: i.maxUses,
        usedCount: i.usedCount,
        expiresAt: i.expiresAt.toISOString(),
        revoked: !!i.revokedAt,
        createdAt: i.createdAt.toISOString(),
      })),
      fields: fields.map((f) => ({
        key: f.key,
        labelTh: f.labelTh,
        fieldType: f.fieldType,
        isRequired: f.isRequired,
        options: f.options.map((o) => ({ value: o.value, labelTh: o.labelTh })),
      })),
      participantTypes: types,
    };
  }

  memberDto(m: MemberRow, selfConsented: boolean): GroupMemberDto {
    const line = m.orderLines.find((l) => l.order.groupId && !['CANCELLED', 'EXPIRED'].includes(l.order.status));
    const answers = new Map<string, string[]>();
    for (const a of m.answers) {
      const v = a.option?.value ?? a.valueText ?? '';
      answers.set(a.field.key, [...(answers.get(a.field.key) ?? []), v]);
    }
    const multiKeys = new Set(m.answers.filter((a) => a.field.fieldType === 'MULTISELECT' || a.field.fieldType === 'CHECKBOX').map((a) => a.field.key));
    return {
      id: m.id,
      referenceNo: isDraftRef(m.referenceNo) ? null : m.referenceNo,
      status: m.status,
      prefix: m.prefix,
      firstName: m.firstName,
      lastName: m.lastName,
      fullName: `${m.prefix ?? ''}${m.firstName} ${m.lastName}`.trim(),
      email: m.email,
      phone: m.phone,
      participantTypeCode: m.participantType.code,
      participantTypeName: m.participantType.nameTh,
      studentOrStaffCode: m.studentOrStaffCode,
      affiliation: m.affiliation,
      program: m.program,
      answers: [...answers.entries()].map(([key, v]) => ({ key, value: multiKeys.has(key) ? v : (v[0] ?? '') })),
      feeName: line?.feeName ?? null,
      feeAmount: line ? moneyOut(line.amount) : null,
      selfConsented,
      createdAt: m.createdAt.toISOString(),
    };
  }

  private settingDto(eventId: string, s: Prisma.EventGroupSettingGetPayload<object> | null): EventGroupSettingDto {
    const v = s ?? DEFAULT_GROUP_SETTING;
    return {
      eventId,
      isEnabled: v.isEnabled,
      minMembers: v.minMembers,
      maxMembers: v.maxMembers,
      maxGroupsPerOrganization: v.maxGroupsPerOrganization,
      allowImport: v.allowImport,
      allowInviteLinks: v.allowInviteLinks,
      memberChangeCloseAt: v.memberChangeCloseAt?.toISOString() ?? null,
    };
  }
}
