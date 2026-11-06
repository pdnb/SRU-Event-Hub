import { Injectable } from '@nestjs/common';
import type { EventDetailDto, EventSummaryDto } from '@sru/shared-types';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import type { RequestMeta } from '../common/decorators';
import { Errors } from '../common/errors';
import { moneyIn, moneyOut } from '../common/money';
import { Paginated } from '../common/pagination';
import { SequenceService } from '../common/sequence.service';
import type { AuthUser } from '../auth/auth.types';
import { EventStatus, Prisma } from '../generated/prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import {
  AdminEventQueryDto,
  CreateEventDto,
  PublicEventQueryDto,
  FeeRateInputDto,
  RegistrationFieldDto,
  RescheduleDto,
  UpdateEventDto,
} from './events.dto';
import { canTransition, EDITABLE_STATUSES, isRegistrationOpen, PUBLIC_STATUSES } from './event-state';

/** Proposed by a FEE_CHANGE approval request (approval_requests.payload). */
export interface FeeChangePayload {
  feeRates: FeeRateInputDto[];
  bankAccountId: string | null;
  incomeCodeId: string | null;
  isPaid: boolean;
}

const summaryInclude = {
  organization: { select: { id: true, nameTh: true } },
  category: { select: { nameTh: true } },
  eventType: { select: { nameTh: true } },
  coverImage: { select: { bucket: true, objectKey: true } },
  feeRates: {
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, nameTh: true, amount: true, participantTypeId: true, validFrom: true, validUntil: true, participantType: { select: { nameTh: true } } },
  },
} satisfies Prisma.EventInclude;

type EventWithSummary = Prisma.EventGetPayload<{ include: typeof summaryInclude }>;

const detailInclude = {
  participantTypes: { include: { participantType: true } },
  registrationFields: {
    where: { isActive: true },
    include: { options: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { sortOrder: 'asc' },
  },
} satisfies Prisma.EventInclude;

type EventWithDetail = Prisma.EventGetPayload<{ include: typeof summaryInclude & typeof detailInclude }>;

/** Fields that may still change after approval without re-approval. */
const POST_APPROVAL_FIELDS = new Set<keyof UpdateEventDto>([
  'description',
  'objectives',
  'targetAudience',
  'conditions',
  'isFeatured',
  'capacity',
  'allowWaitlist',
  'tags',
  'version',
]);

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly seq: SequenceService,
  ) {}

  // ───────────── Queries ─────────────

  async adminList(q: AdminEventQueryDto, user: AuthUser) {
    const where: Prisma.EventWhereInput = {
      deletedAt: null,
      ...(await this.scopeWhere(user, 'event:view')),
      ...(q.status ? { status: q.status } : {}),
      ...(q.organizationId ? { organizationId: q.organizationId } : {}),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.from || q.to
        ? { startAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }
        : {}),
      ...(q.search ? this.searchWhere(q.search) : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({ where, include: summaryInclude, skip: q.skip, take: q.perPage, orderBy: { startAt: q.order } }),
      this.prisma.event.count({ where }),
    ]);
    return Paginated.of(rows.map((e) => this.toSummary(e)), total, q);
  }

  async publicList(q: PublicEventQueryDto) {
    const now = new Date();
    const tabWhere: Prisma.EventWhereInput =
      q.tab === 'open'
        ? {
            endAt: { gt: now },
            OR: [
              { status: 'REGISTRATION_OPEN', OR: [{ registrationCloseAt: null }, { registrationCloseAt: { gt: now } }] },
              {
                status: 'PUBLISHED',
                registrationOpenAt: { lte: now },
                OR: [{ registrationCloseAt: null }, { registrationCloseAt: { gt: now } }],
              },
            ],
          }
        : q.tab === 'upcoming'
          ? { startAt: { gt: now } }
          : q.tab === 'past'
            ? { endAt: { lte: now } }
            : {};
    const where: Prisma.EventWhereInput = {
      deletedAt: null,
      status: { in: [...PUBLIC_STATUSES] },
      AND: [
        tabWhere,
        q.search ? this.searchWhere(q.search) : {},
        q.from ? { endAt: { gte: new Date(q.from) } } : {},
        q.to ? { startAt: { lte: new Date(q.to) } } : {},
      ],
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.eventTypeId ? { eventTypeId: q.eventTypeId } : {}),
      ...(q.organizationId ? { organizationId: q.organizationId } : {}),
      ...(q.isPaid !== undefined ? { isPaid: q.isPaid } : {}),
      ...(q.featured ? { isFeatured: true } : {}),
    };
    const orderBy: Prisma.EventOrderByWithRelationInput =
      q.tab === 'past' ? { startAt: 'desc' } : { startAt: 'asc' };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({ where, include: summaryInclude, skip: q.skip, take: q.perPage, orderBy }),
      this.prisma.event.count({ where }),
    ]);
    return Paginated.of(rows.map((e) => this.toSummary(e)), total, q);
  }

  async publicGet(idOrCode: string): Promise<EventDetailDto> {
    const isUuid = /^[0-9a-f-]{36}$/i.test(idOrCode);
    const e = await this.prisma.event.findFirst({
      where: { ...(isUuid ? { id: idOrCode } : { code: idOrCode }), deletedAt: null, status: { in: [...PUBLIC_STATUSES] } },
      include: { ...summaryInclude, ...detailInclude },
    });
    if (!e) throw Errors.notFound('กิจกรรม');
    // Budget is internal planning data – never exposed on the public portal.
    return { ...this.toDetail(e), budget: null };
  }

  async adminGet(id: string, user: AuthUser) {
    const e = await this.prisma.event.findFirst({
      where: { id, deletedAt: null },
      include: {
        ...summaryInclude,
        ...detailInclude,
        tags: { include: { tag: true } },
        owner: { select: { id: true, displayName: true } },
        venue: { select: { id: true, nameTh: true } },
      },
    });
    if (!e) throw Errors.notFound('กิจกรรม');
    await this.assertCanView(e, user);
    return {
      ...this.toDetail(e),
      version: e.version,
      ownerUserId: e.ownerUserId,
      owner: e.owner,
      venueId: e.venueId,
      venue: e.venue,
      eventTypeId: e.eventTypeId,
      categoryId: e.categoryId,
      isFeatured: e.isFeatured,
      paymentWindowHours: e.paymentWindowHours,
      bankAccountId: e.bankAccountId,
      incomeCodeId: e.incomeCodeId,
      cancelReason: e.cancelReason,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
      tags: e.tags.map((t) => t.tag.name),
    };
  }

  async statusHistory(id: string, user: AuthUser) {
    const e = await this.findOrThrow(id);
    await this.assertCanView(e, user);
    return this.prisma.eventStatusHistory.findMany({
      where: { eventId: id },
      orderBy: { createdAt: 'asc' },
      include: { changedBy: { select: { id: true, displayName: true } } },
    });
  }

  // ───────────── Commands ─────────────

  async create(dto: CreateEventDto, user: AuthUser, meta: RequestMeta) {
    await this.access.assertOrg(user, 'event:create', dto.organizationId);
    this.validateDates(dto);
    const isPaid = this.validateFees(dto.feeRates, dto.bankAccountId);

    return this.prisma.$transaction(async (tx) => {
      const code = await this.seq.next(tx, 'EVT');
      const event = await tx.event.create({
        data: {
          code,
          titleTh: dto.titleTh,
          titleEn: dto.titleEn || null,
          organizationId: dto.organizationId,
          eventTypeId: dto.eventTypeId ?? null,
          categoryId: dto.categoryId ?? null,
          description: dto.description,
          objectives: dto.objectives,
          targetAudience: dto.targetAudience,
          conditions: dto.conditions,
          startAt: new Date(dto.startAt),
          endAt: new Date(dto.endAt),
          registrationOpenAt: dto.registrationOpenAt ? new Date(dto.registrationOpenAt) : null,
          registrationCloseAt: dto.registrationCloseAt ? new Date(dto.registrationCloseAt) : null,
          venueId: dto.venueId ?? null,
          venueText: dto.venueText ?? null,
          capacity: dto.capacity ?? null,
          minParticipants: dto.minParticipants ?? null,
          budget: moneyIn(dto.budget),
          allowGuestRegistration: dto.allowGuestRegistration ?? false,
          allowWaitlist: dto.allowWaitlist ?? true,
          allowSelfCancel: dto.allowSelfCancel ?? true,
          isFeatured: dto.isFeatured ?? false,
          isPaid,
          paymentWindowHours: dto.paymentWindowHours ?? 72,
          bankAccountId: dto.bankAccountId ?? null,
          incomeCodeId: dto.incomeCodeId ?? null,
          ownerUserId: user.id,
          createdById: user.id,
          organizers: { create: { userId: user.id, role: 'OWNER' } },
        },
      });
      await this.syncRelations(tx, event.id, dto);
      if (dto.feeRates) await this.syncFees(tx, event.id, dto.feeRates);
      await tx.eventStatusHistory.create({ data: { eventId: event.id, toStatus: 'DRAFT', changedById: user.id } });
      await this.audit.log({ actorId: user.id, action: 'event.create', entityType: 'event', entityId: event.id, after: { code, titleTh: dto.titleTh }, meta }, tx);
      return { id: event.id, code };
    });
  }

  async update(id: string, dto: UpdateEventDto, user: AuthUser, meta: RequestMeta) {
    const e = await this.findOrThrow(id);
    await this.assertCanManage(e, user, 'event:update');

    const fullyEditable = EDITABLE_STATUSES.includes(e.status);
    if (!fullyEditable) {
      if (e.status === 'CANCELLED' || e.status === 'COMPLETED') throw Errors.invalidState('กิจกรรมนี้ไม่สามารถแก้ไขได้แล้ว');
      if (e.status === 'PENDING_APPROVAL') throw Errors.invalidState('กิจกรรมอยู่ระหว่างการพิจารณา ไม่สามารถแก้ไขได้');
      const blocked = (Object.keys(dto) as (keyof UpdateEventDto)[]).filter(
        (k) => dto[k] !== undefined && !POST_APPROVAL_FIELDS.has(k),
      );
      if (blocked.length) {
        throw Errors.invalidState(
          `หลังอนุมัติแล้ว แก้ไขได้เฉพาะรายละเอียดทั่วไป (ฟิลด์ที่ไม่อนุญาต: ${blocked.join(', ')}) — การเปลี่ยนกำหนดการให้ใช้ "เลื่อนกำหนดการ"` +
            (blocked.some((k) => ['feeRates', 'bankAccountId', 'incomeCodeId'].includes(k)) ? ' และการแก้อัตราค่าลงทะเบียนให้ใช้ "ขอแก้ไขอัตราค่าลงทะเบียน" (ต้องอนุมัติใหม่)' : ''),
        );
      }
    }
    if (dto.capacity != null && dto.capacity < e.seatsTaken) {
      throw Errors.validation(`จำนวนรับต้องไม่น้อยกว่าที่นั่งที่ถูกใช้แล้ว (${e.seatsTaken})`);
    }
    const merged = {
      startAt: dto.startAt ?? e.startAt.toISOString(),
      endAt: dto.endAt ?? e.endAt.toISOString(),
      registrationOpenAt: dto.registrationOpenAt !== undefined ? dto.registrationOpenAt : e.registrationOpenAt?.toISOString(),
      registrationCloseAt: dto.registrationCloseAt !== undefined ? dto.registrationCloseAt : e.registrationCloseAt?.toISOString(),
    };
    this.validateDates(merged);
    const isPaid = dto.feeRates
      ? this.validateFees(dto.feeRates, dto.bankAccountId !== undefined ? dto.bankAccountId : e.bankAccountId)
      : undefined;
    if (isPaid === undefined && dto.bankAccountId === null && e.isPaid) {
      throw Errors.validation('กิจกรรมที่มีค่าลงทะเบียนต้องระบุบัญชีรับเงิน');
    }

    return this.prisma.$transaction(async (tx) => {
      const { version, participantTypeIds: _p, tags: _t, registrationFields: _r, feeRates, budget, ...scalars } = dto;
      // Optimistic concurrency: fails if someone else saved in between.
      const res = await tx.event.updateMany({
        where: { id, version },
        data: {
          ...scalars,
          ...(budget !== undefined ? { budget: moneyIn(budget) } : {}),
          ...(isPaid !== undefined ? { isPaid } : {}),
          ...(dto.startAt ? { startAt: new Date(dto.startAt) } : {}),
          ...(dto.endAt ? { endAt: new Date(dto.endAt) } : {}),
          ...(dto.registrationOpenAt !== undefined ? { registrationOpenAt: dto.registrationOpenAt ? new Date(dto.registrationOpenAt) : null } : {}),
          ...(dto.registrationCloseAt !== undefined ? { registrationCloseAt: dto.registrationCloseAt ? new Date(dto.registrationCloseAt) : null } : {}),
          version: { increment: 1 },
          updatedById: user.id,
        },
      });
      if (res.count !== 1) throw Errors.conflict('VERSION_CONFLICT', 'ข้อมูลถูกแก้ไขโดยผู้อื่นแล้ว กรุณาโหลดข้อมูลใหม่');
      await this.syncRelations(tx, id, dto, fullyEditable);
      if (feeRates) await this.syncFees(tx, id, feeRates);
      await this.audit.log({ actorId: user.id, action: 'event.update', entityType: 'event', entityId: id, before: { version: e.version }, after: dto, meta }, tx);
      return { id, version: version + 1 };
    });
  }

  async remove(id: string, user: AuthUser, meta: RequestMeta) {
    const e = await this.findOrThrow(id);
    await this.assertCanManage(e, user, 'event:delete');
    if (e.status !== 'DRAFT') throw Errors.invalidState('ลบได้เฉพาะกิจกรรมฉบับร่าง — กิจกรรมอื่นให้ใช้การยกเลิก');
    await this.prisma.event.update({ where: { id }, data: { deletedAt: new Date(), updatedById: user.id } });
    await this.audit.log({ actorId: user.id, action: 'event.delete', entityType: 'event', entityId: id, meta });
    return { deleted: true };
  }

  publish(id: string, user: AuthUser, meta: RequestMeta) {
    return this.transition(id, 'PUBLISHED', user, meta, { publishedAt: new Date() });
  }
  openRegistration(id: string, user: AuthUser, meta: RequestMeta) {
    return this.transition(id, 'REGISTRATION_OPEN', user, meta);
  }
  closeRegistration(id: string, user: AuthUser, meta: RequestMeta) {
    return this.transition(id, 'REGISTRATION_CLOSED', user, meta);
  }
  start(id: string, user: AuthUser, meta: RequestMeta) {
    return this.transition(id, 'IN_PROGRESS', user, meta);
  }
  complete(id: string, user: AuthUser, meta: RequestMeta) {
    return this.transition(id, 'COMPLETED', user, meta);
  }

  /**
   * Cancel. Active registrations are cancelled in the same transaction.
   * (Phase 2: paid registrations will automatically get refund requests – spec §4.7.6.)
   */
  async cancel(id: string, reason: string, user: AuthUser, meta: RequestMeta) {
    return this.transition(id, 'CANCELLED', user, meta, { cancelledAt: new Date(), cancelReason: reason }, reason, async (tx) => {
      await tx.registration.updateMany({
        where: { eventId: id, status: { in: ['DRAFT', 'PENDING_PAYMENT', 'CONFIRMED', 'WAITLISTED'] } },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'กิจกรรมถูกยกเลิก' },
      });
      // Group registrations (P3): every open group is cancelled with the event; links stop working.
      const groups = await tx.registrationGroup.findMany({ where: { eventId: id, status: { in: ['DRAFT', 'PENDING_PAYMENT', 'CONFIRMED'] } }, select: { id: true } });
      if (groups.length) {
        const ids = groups.map((g) => g.id);
        await tx.registrationGroup.updateMany({ where: { id: { in: ids } }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'กิจกรรมถูกยกเลิก' } });
        await tx.groupMemberInvitation.updateMany({ where: { groupId: { in: ids }, revokedAt: null }, data: { revokedAt: new Date() } });
        await tx.groupChangeLog.createMany({ data: ids.map((groupId) => ({ groupId, action: 'group.cancel', actorId: user.id, reason: `กิจกรรมถูกยกเลิก: ${reason}` })) });
      }
      await tx.event.update({ where: { id }, data: { seatsTaken: 0 } });
      // Money side (spec §4.7.6): pending slips are voided, unpaid orders cancelled,
      // paid orders flagged for refund (handled by the refund process).
      const now = new Date();
      await tx.payment.updateMany({
        where: { status: 'SUBMITTED', order: { eventId: id } },
        data: { status: 'VOIDED', voidedAt: now, voidedById: user.id, voidReason: 'กิจกรรมถูกยกเลิก' },
      });
      await tx.paymentOrder.updateMany({
        where: { eventId: id, status: { in: ['UNPAID', 'PENDING_VERIFICATION'] } },
        data: { status: 'CANCELLED', closedAt: now, closeReason: 'กิจกรรมถูกยกเลิก' },
      });
      await tx.paymentOrder.updateMany({ where: { eventId: id, status: 'PAID' }, data: { status: 'REFUND_PENDING', closeReason: 'กิจกรรมถูกยกเลิก' } });
    });
  }

  async reschedule(id: string, dto: RescheduleDto, user: AuthUser, meta: RequestMeta) {
    const e = await this.findOrThrow(id);
    await this.assertCanManage(e, user, 'event:update');
    if (['CANCELLED', 'COMPLETED'].includes(e.status)) throw Errors.invalidState('ไม่สามารถเลื่อนกำหนดการได้');
    this.validateDates({ ...dto, registrationOpenAt: e.registrationOpenAt?.toISOString(), registrationCloseAt: e.registrationCloseAt?.toISOString() });
    return this.prisma.$transaction(async (tx) => {
      await tx.event.update({
        where: { id },
        data: { startAt: new Date(dto.startAt), endAt: new Date(dto.endAt), ...(dto.venueText ? { venueText: dto.venueText } : {}), version: { increment: 1 }, updatedById: user.id },
      });
      await tx.eventStatusHistory.create({
        data: { eventId: id, fromStatus: e.status, toStatus: e.status, changedById: user.id, reason: `เลื่อนกำหนดการ: ${dto.reason}` },
      });
      await this.audit.log({
        actorId: user.id, action: 'event.reschedule', entityType: 'event', entityId: id,
        before: { startAt: e.startAt, endAt: e.endAt, venueText: e.venueText }, after: dto, reason: dto.reason, meta,
      }, tx);
      return { id };
    });
  }

  // ───────────── Internals (also used by ApprovalsService) ─────────────

  async findOrThrow(id: string) {
    const e = await this.prisma.event.findFirst({ where: { id, deletedAt: null } });
    if (!e) throw Errors.notFound('กิจกรรม');
    return e;
  }

  /** Apply a status transition with history + audit, optionally running extra work in the same tx. */
  async transition(
    id: string,
    to: EventStatus,
    user: AuthUser,
    meta: RequestMeta,
    data: Prisma.EventUncheckedUpdateManyInput = {},
    reason?: string,
    extra?: (tx: Tx) => Promise<void>,
  ) {
    const e = await this.findOrThrow(id);
    await this.assertCanManage(e, user, to === 'CANCELLED' ? 'event:delete' : 'event:update');
    if (!canTransition(e.status, to)) {
      throw Errors.invalidState(`ไม่สามารถเปลี่ยนสถานะจาก ${e.status} เป็น ${to} ได้`);
    }
    return this.prisma.$transaction(async (tx) => {
      // Guard against concurrent transitions by matching the current status.
      const res = await tx.event.updateMany({
        where: { id, status: e.status },
        data: { ...data, status: to, version: { increment: 1 }, updatedById: user.id },
      });
      if (res.count !== 1) throw Errors.conflict('STATUS_CHANGED', 'สถานะกิจกรรมถูกเปลี่ยนโดยผู้อื่นแล้ว');
      await tx.eventStatusHistory.create({ data: { eventId: id, fromStatus: e.status, toStatus: to, changedById: user.id, reason } });
      if (extra) await extra(tx);
      await this.audit.log({ actorId: user.id, action: `event.status.${to.toLowerCase()}`, entityType: 'event', entityId: id, before: { status: e.status }, after: { status: to }, reason, meta }, tx);
      return { id, status: to };
    });
  }

  async assertCanManage(e: { organizationId: string; ownerUserId: string; createdById: string }, user: AuthUser, code: 'event:update' | 'event:delete' | 'event:view') {
    if (!this.access.has(user, code)) throw Errors.forbidden();
    if (this.access.ownOnly(user, code)) {
      if (e.ownerUserId !== user.id && e.createdById !== user.id) throw Errors.forbidden();
      return;
    }
    await this.access.assertOrg(user, code, e.organizationId);
  }

  private assertCanView(e: { organizationId: string; ownerUserId: string; createdById: string }, user: AuthUser) {
    return this.assertCanManage(e, user, 'event:view');
  }

  private async scopeWhere(user: AuthUser, code: 'event:view'): Promise<Prisma.EventWhereInput> {
    if (this.access.ownOnly(user, code)) return { OR: [{ ownerUserId: user.id }, { createdById: user.id }] };
    const scope = await this.access.orgScope(user, code);
    if (scope === 'ALL') return {};
    return { OR: [{ organizationId: { in: scope } }, { ownerUserId: user.id }] };
  }

  private searchWhere(search: string): Prisma.EventWhereInput {
    return {
      OR: [
        { titleTh: { contains: search, mode: 'insensitive' } },
        { titleEn: { contains: search, mode: 'insensitive' } },
        { code: { equals: search.toUpperCase() } },
        { tags: { some: { tag: { name: { equals: search, mode: 'insensitive' } } } } },
      ],
    };
  }

  private validateDates(d: { startAt: string; endAt: string; registrationOpenAt?: string | null; registrationCloseAt?: string | null }) {
    const start = new Date(d.startAt);
    const end = new Date(d.endAt);
    if (!(end > start)) throw Errors.validation('วันเวลาสิ้นสุดต้องอยู่หลังวันเวลาเริ่มต้น');
    const open = d.registrationOpenAt ? new Date(d.registrationOpenAt) : null;
    const close = d.registrationCloseAt ? new Date(d.registrationCloseAt) : null;
    if (open && close && !(close > open)) throw Errors.validation('วันปิดรับสมัครต้องอยู่หลังวันเปิดรับสมัคร');
    if (close && close > end) throw Errors.validation('วันปิดรับสมัครต้องไม่เกินวันสิ้นสุดกิจกรรม');
  }

  /** Returns isPaid. A paid event needs a receiving account (FIN-4) so invoices can be issued. */
  validateFees(rates: FeeRateInputDto[] | undefined, bankAccountId: string | null | undefined): boolean {
    if (!rates) return false;
    for (const r of rates) {
      if (r.validFrom && r.validUntil && !(new Date(r.validUntil) > new Date(r.validFrom))) {
        throw Errors.validation(`อัตรา "${r.nameTh}": วันสิ้นสุดต้องอยู่หลังวันเริ่มต้น`);
      }
    }
    const isPaid = rates.some((r) => Number(r.amount) > 0);
    if (isPaid && !bankAccountId) throw Errors.validation('กิจกรรมที่มีค่าลงทะเบียนต้องระบุบัญชีรับเงิน');
    return isPaid;
  }

  /**
   * Applies an approved FEE_CHANGE request (called by ApprovalsService inside the decision
   * transaction). Orders already issued keep their own amount snapshot.
   */
  async applyFeeChange(tx: Tx, eventId: string, p: FeeChangePayload, userId: string) {
    await this.syncFees(tx, eventId, p.feeRates);
    await tx.event.update({
      where: { id: eventId },
      data: { isPaid: p.isPaid, bankAccountId: p.bankAccountId, incomeCodeId: p.incomeCodeId, version: { increment: 1 }, updatedById: userId },
    });
  }

  /** Old rates are deactivated (orders keep their own snapshot and FK), new ones inserted. */
  private async syncFees(tx: Tx, eventId: string, rates: FeeRateInputDto[]) {
    await tx.eventFeeRate.updateMany({ where: { eventId, isActive: true }, data: { isActive: false } });
    if (!rates.length) return;
    await tx.eventFeeRate.createMany({
      data: rates.map((r, i) => ({
        eventId,
        nameTh: r.nameTh.trim(),
        amount: moneyIn(r.amount)!,
        participantTypeId: r.participantTypeId ?? null,
        validFrom: r.validFrom ? new Date(r.validFrom) : null,
        validUntil: r.validUntil ? new Date(r.validUntil) : null,
        sortOrder: i,
      })),
    });
  }

  private async syncRelations(
    tx: Tx,
    eventId: string,
    dto: Pick<CreateEventDto, 'participantTypeIds' | 'tags' | 'registrationFields'>,
    allowFieldChanges = true,
  ) {
    if (dto.participantTypeIds && allowFieldChanges) {
      await tx.eventParticipantType.deleteMany({ where: { eventId } });
      if (dto.participantTypeIds.length) {
        await tx.eventParticipantType.createMany({
          data: [...new Set(dto.participantTypeIds)].map((participantTypeId) => ({ eventId, participantTypeId })),
        });
      }
    }
    if (dto.tags) {
      await tx.eventTag.deleteMany({ where: { eventId } });
      for (const name of [...new Set(dto.tags.map((t) => t.trim()).filter(Boolean))]) {
        const tag = await tx.tag.upsert({ where: { name }, create: { name }, update: {} });
        await tx.eventTag.create({ data: { eventId, tagId: tag.id } });
      }
    }
    if (dto.registrationFields && allowFieldChanges) await this.syncFields(tx, eventId, dto.registrationFields);
  }

  /** Fields with answers are deactivated, not deleted, so historical answers stay intact. */
  private async syncFields(tx: Tx, eventId: string, fields: RegistrationFieldDto[]) {
    const keys = new Set<string>();
    for (const [i, f] of fields.entries()) {
      if (keys.has(f.key)) throw Errors.validation(`ฟิลด์ซ้ำ: ${f.key}`);
      keys.add(f.key);
      const needsOptions = ['SELECT', 'MULTISELECT', 'RADIO'].includes(f.fieldType);
      if (needsOptions && !f.options?.length) throw Errors.validation(`ฟิลด์ ${f.key} ต้องมีตัวเลือก`);
      const row = await tx.registrationField.upsert({
        where: { eventId_key: { eventId, key: f.key } },
        create: { eventId, key: f.key, labelTh: f.labelTh, fieldType: f.fieldType, isRequired: f.isRequired ?? false, helpText: f.helpText, maxLength: f.maxLength, sortOrder: i },
        update: { labelTh: f.labelTh, fieldType: f.fieldType, isRequired: f.isRequired ?? false, helpText: f.helpText, maxLength: f.maxLength, sortOrder: i, isActive: true },
      });
      if (needsOptions) {
        for (const [j, o] of f.options!.entries()) {
          await tx.registrationFieldOption.upsert({
            where: { fieldId_value: { fieldId: row.id, value: o.value } },
            create: { fieldId: row.id, value: o.value, labelTh: o.labelTh, sortOrder: j },
            update: { labelTh: o.labelTh, sortOrder: j },
          });
        }
      }
    }
    await tx.registrationField.updateMany({ where: { eventId, key: { notIn: [...keys] } }, data: { isActive: false } });
  }

  toSummary(e: EventWithSummary): EventSummaryDto {
    return {
      id: e.id,
      code: e.code,
      titleTh: e.titleTh,
      titleEn: e.titleEn,
      status: e.status,
      approvalStatus: e.approvalStatus,
      organizationId: e.organizationId,
      organizationName: e.organization.nameTh,
      categoryName: e.category?.nameTh ?? null,
      eventTypeName: e.eventType?.nameTh ?? null,
      startAt: e.startAt.toISOString(),
      endAt: e.endAt.toISOString(),
      registrationOpenAt: e.registrationOpenAt?.toISOString() ?? null,
      registrationCloseAt: e.registrationCloseAt?.toISOString() ?? null,
      venueText: e.venueText,
      capacity: e.capacity,
      seatsTaken: e.seatsTaken,
      isPaid: e.isPaid,
      // Lowest non-zero rate ("เริ่มต้น … บาท"); free participant-type rates are shown on the detail page.
      minFee: (() => {
        const paid = e.feeRates.filter((r) => r.amount.greaterThan(0));
        return e.isPaid && paid.length ? moneyOut(paid.reduce((m, r) => (r.amount.lessThan(m) ? r.amount : m), paid[0]!.amount)) : null;
      })(),
      coverImageUrl: e.coverImage ? `/files/public/${e.coverImage.objectKey}` : null,
      registrationOpen: isRegistrationOpen(e),
    };
  }

  private toDetail(e: EventWithDetail): EventDetailDto {
    return {
      ...this.toSummary(e),
      description: e.description,
      objectives: e.objectives,
      targetAudience: e.targetAudience,
      conditions: e.conditions,
      minParticipants: e.minParticipants,
      budget: moneyOut(e.budget),
      allowGuestRegistration: e.allowGuestRegistration,
      allowWaitlist: e.allowWaitlist,
      allowSelfCancel: e.allowSelfCancel,
      registrationFields: e.registrationFields.map((f) => ({
        key: f.key,
        labelTh: f.labelTh,
        fieldType: f.fieldType,
        isRequired: f.isRequired,
        helpText: f.helpText,
        maxLength: f.maxLength,
        options: f.options.map((o) => ({ value: o.value, labelTh: o.labelTh })),
      })),
      feeRates: e.feeRates.map((r) => ({
        id: r.id,
        nameTh: r.nameTh,
        amount: moneyOut(r.amount)!,
        participantTypeId: r.participantTypeId,
        participantTypeName: r.participantType?.nameTh ?? null,
        validFrom: r.validFrom?.toISOString() ?? null,
        validUntil: r.validUntil?.toISOString() ?? null,
      })),
      participantTypes: e.participantTypes.map((p) => ({
        id: p.participantType.id,
        code: p.participantType.code,
        nameTh: p.participantType.nameTh,
      })),
    };
  }
}
