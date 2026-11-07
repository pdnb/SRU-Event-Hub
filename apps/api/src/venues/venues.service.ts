import { HttpStatus, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { EventAccessService } from '../checkin/event-access.service';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import type { RequestMeta } from '../common/decorators';
import { AppError, Errors } from '../common/errors';
import { Paginated } from '../common/pagination';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import {
  AvailabilityQueryDto,
  BookingQueryDto,
  BuildingDto,
  CatalogQueryDto,
  ResourceBookingDto,
  ResourceDto,
  VenueBookingDto,
  VenueDto,
} from './venues.dto';

const MAX_SPAN_MS = 31 * 86400_000;
const LIVE = ['PENDING', 'APPROVED'] as const;

/** Peak of overlapping quantities inside [from, to) — evaluated at each interval start. */
export function peakUsage(bookings: { startAt: Date; endAt: Date; quantity: number }[], from: Date, to: Date): number {
  const points = [from, ...bookings.map((b) => b.startAt).filter((t) => t > from && t < to)];
  let peak = 0;
  for (const t of points) {
    const used = bookings.filter((b) => b.startAt <= t && b.endAt > t).reduce((s, b) => s + b.quantity, 0);
    peak = Math.max(peak, used);
  }
  return peak;
}

/**
 * Venues, equipment and their bookings (spec §4.13).
 *
 * Venue double-booking is impossible at the database level (EXCLUDE constraint over APPROVED
 * bookings); equipment stock is enforced by a trigger that locks the item row. The service checks
 * first to give a readable answer and maps the database errors when a concurrent approval wins.
 * Approval follows the managing unit of the venue / item (venue:approve on that unit; central items
 * need ALL scope) and the approver may not decide their own request.
 */
@Injectable()
export class VenuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly eventAccess: EventAccessService,
  ) {}

  // ───────────── catalogue ─────────────

  buildings() {
    return this.prisma.building.findMany({ orderBy: [{ isActive: 'desc' }, { code: 'asc' }], include: { _count: { select: { venues: true } } } });
  }

  async saveBuilding(id: string | null, dto: BuildingDto, user: AuthUser, meta: RequestMeta) {
    await this.assertManage(user, null);
    const data = { code: dto.code.trim().toUpperCase(), nameTh: dto.nameTh.trim(), campus: dto.campus?.trim() || null, address: dto.address?.trim() || null, isActive: dto.isActive ?? true };
    const b = await this.unique(() => (id ? this.prisma.building.update({ where: { id }, data }) : this.prisma.building.create({ data })));
    await this.audit.log({ actorId: user.id, action: id ? 'building.update' : 'building.create', entityType: 'building', entityId: b.id, after: data, meta });
    return b;
  }

  async venues(q: CatalogQueryDto) {
    const where: Prisma.VenueWhereInput = {
      ...(q.includeInactive === 'true' ? {} : { isActive: true }),
      ...(q.buildingId ? { buildingId: q.buildingId } : {}),
      ...(q.venueType ? { venueType: q.venueType } : {}),
      ...(q.minCapacity ? { capacity: { gte: q.minCapacity } } : {}),
      ...(q.search ? { OR: [{ nameTh: { contains: q.search, mode: 'insensitive' } }, { code: { contains: q.search, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.venue.findMany({
        where,
        include: { building: { select: { id: true, code: true, nameTh: true } }, organization: { select: { id: true, nameTh: true } }, _count: { select: { resources: true } } },
        orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
        skip: q.skip,
        take: q.perPage,
      }),
      this.prisma.venue.count({ where }),
    ]);
    return Paginated.of(rows, total, q);
  }

  async venue(id: string) {
    const v = await this.prisma.venue.findUnique({
      where: { id },
      include: { building: true, organization: { select: { id: true, nameTh: true } }, resources: { where: { isActive: true }, orderBy: { code: 'asc' } } },
    });
    if (!v) throw Errors.notFound('สถานที่');
    return v;
  }

  async saveVenue(id: string | null, dto: VenueDto, user: AuthUser, meta: RequestMeta) {
    if (id) await this.assertManage(user, (await this.venue(id)).organizationId);
    await this.assertManage(user, dto.organizationId ?? null);
    const data = {
      code: dto.code.trim().toUpperCase(), nameTh: dto.nameTh.trim(), venueType: dto.venueType, buildingId: dto.buildingId ?? null, organizationId: dto.organizationId ?? null,
      capacity: dto.capacity ?? null, floor: dto.floor?.trim() || null, description: dto.description?.trim() || null, autoApprove: dto.autoApprove ?? false, isActive: dto.isActive ?? true,
    };
    const v = await this.unique(() => (id ? this.prisma.venue.update({ where: { id }, data }) : this.prisma.venue.create({ data })));
    await this.audit.log({ actorId: user.id, action: id ? 'venue.update' : 'venue.create', entityType: 'venue', entityId: v.id, after: data, meta });
    return v;
  }

  async resources(q: CatalogQueryDto & { venueId?: string }) {
    const where: Prisma.ResourceWhereInput = {
      ...(q.includeInactive === 'true' ? {} : { isActive: true }),
      ...(q.search ? { OR: [{ nameTh: { contains: q.search, mode: 'insensitive' } }, { code: { contains: q.search, mode: 'insensitive' } }, { resourceType: { contains: q.search, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.resource.findMany({
        where,
        include: { venue: { select: { id: true, code: true, nameTh: true } }, organization: { select: { id: true, nameTh: true } } },
        orderBy: [{ isActive: 'desc' }, { resourceType: 'asc' }, { code: 'asc' }],
        skip: q.skip,
        take: q.perPage,
      }),
      this.prisma.resource.count({ where }),
    ]);
    return Paginated.of(rows, total, q);
  }

  async saveResource(id: string | null, dto: ResourceDto, user: AuthUser, meta: RequestMeta) {
    if (id) {
      const cur = await this.prisma.resource.findUnique({ where: { id } });
      if (!cur) throw Errors.notFound('ครุภัณฑ์/อุปกรณ์');
      await this.assertManage(user, cur.organizationId);
      if (dto.quantity < cur.quantity) {
        const future = await this.prisma.resourceBooking.findMany({ where: { resourceId: id, status: 'APPROVED', endAt: { gt: new Date() } }, select: { startAt: true, endAt: true, quantity: true } });
        const peak = Math.max(0, ...future.map((b) => peakUsage(future, b.startAt, b.endAt)));
        if (peak > dto.quantity) throw Errors.invalidState(`มีการจองที่อนุมัติแล้วสูงสุด ${peak} ชิ้นพร้อมกัน จึงลดจำนวนต่ำกว่านั้นไม่ได้`);
      }
    }
    await this.assertManage(user, dto.organizationId ?? null);
    const data = {
      code: dto.code.trim().toUpperCase(), nameTh: dto.nameTh.trim(), resourceType: dto.resourceType.trim(), quantity: dto.quantity, venueId: dto.venueId ?? null,
      organizationId: dto.organizationId ?? null, description: dto.description?.trim() || null, isActive: dto.isActive ?? true,
    };
    const r = await this.unique(() => (id ? this.prisma.resource.update({ where: { id }, data }) : this.prisma.resource.create({ data })));
    await this.audit.log({ actorId: user.id, action: id ? 'resource.update' : 'resource.create', entityType: 'resource', entityId: r.id, after: data, meta });
    return r;
  }

  // ───────────── availability ─────────────

  /** Venues with what overlaps the window: approved (busy) and pending requests. */
  async availability(q: AvailabilityQueryDto) {
    const { from, to } = this.window(q.from, q.to);
    const venues = await this.prisma.venue.findMany({
      where: { isActive: true, ...(q.minCapacity ? { capacity: { gte: q.minCapacity } } : {}), ...(q.venueType ? { venueType: q.venueType } : {}) },
      include: {
        building: { select: { nameTh: true } },
        bookings: {
          where: { status: { in: [...LIVE] }, startAt: { lt: to }, endAt: { gt: from } },
          select: { id: true, status: true, startAt: true, endAt: true, purpose: true, event: { select: { code: true, titleTh: true } } },
          orderBy: { startAt: 'asc' },
        },
      },
      orderBy: [{ capacity: 'asc' }, { code: 'asc' }],
    });
    return venues.map(({ bookings, ...v }) => ({
      ...v,
      free: !bookings.some((b) => b.status === 'APPROVED'),
      approved: bookings.filter((b) => b.status === 'APPROVED'),
      pending: bookings.filter((b) => b.status === 'PENDING').length,
    }));
  }

  async resourceAvailability(resourceId: string, fromIso: string, toIso: string) {
    const { from, to } = this.window(fromIso, toIso);
    const r = await this.prisma.resource.findUnique({ where: { id: resourceId } });
    if (!r) throw Errors.notFound('ครุภัณฑ์/อุปกรณ์');
    const approved = await this.prisma.resourceBooking.findMany({ where: { resourceId, status: 'APPROVED', startAt: { lt: to }, endAt: { gt: from } }, select: { startAt: true, endAt: true, quantity: true } });
    const used = peakUsage(approved, from, to);
    return { resourceId, quantity: r.quantity, used, available: Math.max(0, r.quantity - used) };
  }

  // ───────────── venue bookings ─────────────

  async bookings(q: BookingQueryDto, user: AuthUser) {
    const where: Prisma.VenueBookingWhereInput = {
      ...(q.venueId ? { venueId: q.venueId } : {}),
      ...(q.eventId ? { eventId: q.eventId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.from ? { endAt: { gt: new Date(q.from) } } : {}),
      ...(q.to ? { startAt: { lt: new Date(q.to) } } : {}),
      ...(q.view === 'mine' ? { requestedById: user.id } : {}),
      ...(q.view === 'approve' ? { status: 'PENDING', requestedById: { not: user.id }, venue: await this.approvableWhere(user) } : {}),
      ...(q.search ? { OR: [{ purpose: { contains: q.search, mode: 'insensitive' } }, { event: { titleTh: { contains: q.search, mode: 'insensitive' } } }, { venue: { nameTh: { contains: q.search, mode: 'insensitive' } } }] } : {}),
    };
    if (!q.view && !q.eventId && !this.access.has(user, 'venue:view')) throw Errors.forbidden();
    if (q.eventId && !q.view) await this.eventAccess.assert(user, 'event:view', q.eventId);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.venueBooking.findMany({
        where,
        include: {
          venue: { select: { id: true, code: true, nameTh: true, capacity: true } },
          event: { select: { id: true, code: true, titleTh: true } },
          requestedBy: { select: { displayName: true } },
          decidedBy: { select: { displayName: true } },
        },
        orderBy: { startAt: q.view === 'approve' ? 'asc' : q.order },
        skip: q.skip,
        take: q.perPage,
      }),
      this.prisma.venueBooking.count({ where }),
    ]);
    return Paginated.of(rows, total, q);
  }

  async requestVenue(dto: VenueBookingDto, user: AuthUser, meta: RequestMeta) {
    const { from, to } = this.window(dto.startAt, dto.endAt);
    if (from < new Date(Date.now() - 3600_000)) throw Errors.validation('จองย้อนหลังไม่ได้');
    const v = await this.prisma.venue.findUnique({ where: { id: dto.venueId } });
    if (!v || !v.isActive) throw Errors.notFound('สถานที่');
    if (dto.eventId) await this.assertEventBooking(dto.eventId, user);
    else if (!this.access.has(user, 'venue:view')) throw Errors.forbidden();
    const clash = await this.prisma.venueBooking.findFirst({
      where: { venueId: v.id, status: 'APPROVED', startAt: { lt: to }, endAt: { gt: from } },
      select: { startAt: true, endAt: true, event: { select: { titleTh: true } }, purpose: true },
    });
    if (clash) throw new AppError('VENUE_CONFLICT', `${v.nameTh} ไม่ว่างในช่วงเวลานี้ (จองแล้วสำหรับ ${clash.event?.titleTh ?? clash.purpose ?? 'การใช้งานอื่น'})`, HttpStatus.CONFLICT, { clash });
    const auto = v.autoApprove;
    const b = await this.mapConflict(() =>
      this.prisma.$transaction(async (tx) => {
        if (auto) await this.lockVenue(tx, v.id);
        const b = await tx.venueBooking.create({
          data: {
            venueId: v.id, eventId: dto.eventId ?? null, startAt: from, endAt: to, purpose: dto.purpose?.trim() || null, requestedById: user.id,
            status: auto ? 'APPROVED' : 'PENDING', ...(auto ? { decidedAt: new Date(), decisionNote: 'อนุมัติอัตโนมัติ (สถานที่กำหนดให้อนุมัติอัตโนมัติ)' } : {}),
          },
        });
        await this.audit.log({ actorId: user.id, action: auto ? 'venue_booking.auto_approve' : 'venue_booking.request', entityType: 'venue_booking', entityId: b.id, after: { venueId: v.id, eventId: dto.eventId ?? null, startAt: from, endAt: to }, meta }, tx);
        return b;
      }),
    );
    return b;
  }

  async decideVenue(id: string, decision: 'APPROVE' | 'REJECT', note: string | undefined, user: AuthUser, meta: RequestMeta) {
    const b = await this.prisma.venueBooking.findUnique({ where: { id }, include: { venue: true } });
    if (!b) throw Errors.notFound('การจองสถานที่');
    await this.assertApprove(user, b.venue.organizationId, b.requestedById);
    if (b.status !== 'PENDING') throw Errors.invalidState('รายการนี้ได้รับการพิจารณาแล้ว');
    if (decision === 'APPROVE' && b.endAt <= new Date()) throw Errors.invalidState('ช่วงเวลาที่ขอจองผ่านไปแล้ว');
    return this.mapConflict(() =>
      this.prisma.$transaction(async (tx) => {
        // Approvals of one room are serialised: without this, two concurrent approvals each hold their own
        // booking row while the exclusion check waits for the other → deadlock (40P01) instead of a clean conflict.
        if (decision === 'APPROVE') await this.lockVenue(tx, b.venueId);
        const n = await tx.venueBooking.updateMany({
          where: { id, status: 'PENDING' },
          data: { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedById: user.id, decidedAt: new Date(), decisionNote: note?.trim() || null },
        });
        if (!n.count) throw Errors.invalidState('รายการนี้ได้รับการพิจารณาแล้ว');
        await this.audit.log({ actorId: user.id, action: `venue_booking.${decision.toLowerCase()}`, entityType: 'venue_booking', entityId: id, before: { status: 'PENDING' }, after: { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED' }, reason: note ?? null, meta }, tx);
        return tx.venueBooking.findUniqueOrThrow({ where: { id } });
      }),
    );
  }

  async cancelVenue(id: string, reason: string | undefined, user: AuthUser, meta: RequestMeta) {
    const b = await this.prisma.venueBooking.findUnique({ where: { id }, include: { venue: true } });
    if (!b) throw Errors.notFound('การจองสถานที่');
    await this.assertCancel(user, b.requestedById, b.eventId, b.venue.organizationId);
    if (!(LIVE as readonly string[]).includes(b.status)) throw Errors.invalidState('รายการนี้สิ้นสุดแล้ว');
    await this.prisma.$transaction(async (tx) => {
      await tx.venueBooking.update({ where: { id }, data: { status: 'CANCELLED', decisionNote: reason?.trim() || b.decisionNote } });
      await this.audit.log({ actorId: user.id, action: 'venue_booking.cancel', entityType: 'venue_booking', entityId: id, before: { status: b.status }, after: { status: 'CANCELLED' }, reason: reason ?? null, meta }, tx);
    });
    return { id, status: 'CANCELLED' };
  }

  // ───────────── equipment bookings ─────────────

  async resourceBookings(q: BookingQueryDto, user: AuthUser) {
    const where: Prisma.ResourceBookingWhereInput = {
      ...(q.resourceId ? { resourceId: q.resourceId } : {}),
      ...(q.eventId ? { eventId: q.eventId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.from ? { endAt: { gt: new Date(q.from) } } : {}),
      ...(q.to ? { startAt: { lt: new Date(q.to) } } : {}),
      ...(q.view === 'mine' ? { requestedById: user.id } : {}),
      ...(q.view === 'approve' ? { status: 'PENDING', OR: [{ requestedById: null }, { requestedById: { not: user.id } }], resource: await this.approvableWhere(user) } : {}),
    };
    if (!q.view && !q.eventId && !this.access.has(user, 'venue:view')) throw Errors.forbidden();
    if (q.eventId && !q.view) await this.eventAccess.assert(user, 'event:view', q.eventId);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.resourceBooking.findMany({
        where,
        include: {
          resource: { select: { id: true, code: true, nameTh: true, quantity: true, resourceType: true } },
          event: { select: { id: true, code: true, titleTh: true } },
          requestedBy: { select: { displayName: true } },
          decidedBy: { select: { displayName: true } },
        },
        orderBy: { startAt: q.view === 'approve' ? 'asc' : q.order },
        skip: q.skip,
        take: q.perPage,
      }),
      this.prisma.resourceBooking.count({ where }),
    ]);
    return Paginated.of(rows, total, q);
  }

  async requestResource(dto: ResourceBookingDto, user: AuthUser, meta: RequestMeta) {
    const { from, to } = this.window(dto.startAt, dto.endAt);
    if (from < new Date(Date.now() - 3600_000)) throw Errors.validation('จองย้อนหลังไม่ได้');
    const r = await this.prisma.resource.findUnique({ where: { id: dto.resourceId } });
    if (!r || !r.isActive) throw Errors.notFound('ครุภัณฑ์/อุปกรณ์');
    if (dto.eventId) await this.assertEventBooking(dto.eventId, user);
    else if (!this.access.has(user, 'venue:view')) throw Errors.forbidden();
    const av = await this.resourceAvailability(r.id, dto.startAt, dto.endAt);
    if (dto.quantity > av.available) throw new AppError('RESOURCE_UNAVAILABLE', `${r.nameTh} ว่าง ${av.available} จาก ${r.quantity} ในช่วงเวลานี้`, HttpStatus.CONFLICT, av);
    return this.prisma.$transaction(async (tx) => {
      const b = await tx.resourceBooking.create({ data: { resourceId: r.id, eventId: dto.eventId ?? null, quantity: dto.quantity, startAt: from, endAt: to, purpose: dto.purpose?.trim() || null, requestedById: user.id } });
      await this.audit.log({ actorId: user.id, action: 'resource_booking.request', entityType: 'resource_booking', entityId: b.id, after: { resourceId: r.id, quantity: dto.quantity, eventId: dto.eventId ?? null, startAt: from, endAt: to }, meta }, tx);
      return b;
    });
  }

  async decideResource(id: string, decision: 'APPROVE' | 'REJECT', note: string | undefined, user: AuthUser, meta: RequestMeta) {
    const b = await this.prisma.resourceBooking.findUnique({ where: { id }, include: { resource: true } });
    if (!b) throw Errors.notFound('การจองอุปกรณ์');
    await this.assertApprove(user, b.resource.organizationId, b.requestedById);
    if (b.status !== 'PENDING') throw Errors.invalidState('รายการนี้ได้รับการพิจารณาแล้ว');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const n = await tx.resourceBooking.updateMany({
          where: { id, status: 'PENDING' },
          data: { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedById: user.id, decidedAt: new Date(), decisionNote: note?.trim() || null },
        });
        if (!n.count) throw Errors.invalidState('รายการนี้ได้รับการพิจารณาแล้ว');
        await this.audit.log({ actorId: user.id, action: `resource_booking.${decision.toLowerCase()}`, entityType: 'resource_booking', entityId: id, before: { status: 'PENDING' }, after: { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED' }, reason: note ?? null, meta }, tx);
        return tx.resourceBooking.findUniqueOrThrow({ where: { id } });
      });
    } catch (e) {
      if (String((e as Error)?.message ?? '').includes('RESOURCE_STOCK')) {
        const av = await this.resourceAvailability(b.resourceId, b.startAt.toISOString(), b.endAt.toISOString());
        throw new AppError('RESOURCE_UNAVAILABLE', `${b.resource.nameTh} เหลือว่าง ${av.available} จาก ${av.quantity} ในช่วงเวลานี้ จึงอนุมัติ ${b.quantity} ไม่ได้`, HttpStatus.CONFLICT, av);
      }
      throw e;
    }
  }

  async cancelResource(id: string, reason: string | undefined, user: AuthUser, meta: RequestMeta) {
    const b = await this.prisma.resourceBooking.findUnique({ where: { id }, include: { resource: true } });
    if (!b) throw Errors.notFound('การจองอุปกรณ์');
    await this.assertCancel(user, b.requestedById, b.eventId, b.resource.organizationId);
    if (!(LIVE as readonly string[]).includes(b.status)) throw Errors.invalidState('รายการนี้สิ้นสุดแล้ว');
    await this.prisma.$transaction(async (tx) => {
      await tx.resourceBooking.update({ where: { id }, data: { status: 'CANCELLED', decisionNote: reason?.trim() || b.decisionNote } });
      await this.audit.log({ actorId: user.id, action: 'resource_booking.cancel', entityType: 'resource_booking', entityId: id, before: { status: b.status }, after: { status: 'CANCELLED' }, reason: reason ?? null, meta }, tx);
    });
    return { id, status: 'CANCELLED' };
  }

  // ───────────── helpers ─────────────

  /** Venues / items whose managing unit is inside the user's venue:approve scope. */
  private async approvableWhere(user: AuthUser): Promise<{ organizationId?: { in: string[] } } | Record<string, never>> {
    if (!this.access.has(user, 'venue:approve')) return { organizationId: { in: [] } };
    const scope = await this.access.orgScope(user, 'venue:approve');
    return scope === 'ALL' ? {} : { organizationId: { in: scope } };
  }

  private async assertApprove(user: AuthUser, organizationId: string | null, requestedById: string | null) {
    const scope = this.access.has(user, 'venue:approve') ? await this.access.orgScope(user, 'venue:approve') : [];
    const ok = scope === 'ALL' || (!!organizationId && scope.includes(organizationId));
    if (!ok) throw Errors.forbidden('ไม่มีสิทธิ์พิจารณาการจองของสถานที่/อุปกรณ์นี้');
    if (requestedById === user.id) throw Errors.forbidden('ผู้ขอจองพิจารณาคำขอของตนเองไม่ได้');
  }

  private async assertManage(user: AuthUser, organizationId: string | null) {
    const code = 'venue:update' as const;
    if (!this.access.has(user, code) && !this.access.has(user, 'venue:create')) throw Errors.forbidden();
    const scope = await this.access.orgScope(user, this.access.has(user, code) ? code : 'venue:create');
    if (scope !== 'ALL' && (!organizationId || !scope.includes(organizationId))) throw Errors.forbidden('จัดการได้เฉพาะสถานที่/อุปกรณ์ของหน่วยงานในความรับผิดชอบ');
  }

  private async assertCancel(user: AuthUser, requestedById: string | null, eventId: string | null, organizationId: string | null) {
    if (requestedById === user.id) return;
    if (eventId && (await this.eventAccess.can(user, 'event:update', await this.eventAccess.event(eventId)))) return;
    const scope = this.access.has(user, 'venue:approve') ? await this.access.orgScope(user, 'venue:approve') : [];
    if (scope === 'ALL' || (!!organizationId && scope.includes(organizationId))) return;
    throw Errors.forbidden();
  }

  private async assertEventBooking(eventId: string, user: AuthUser) {
    const e = await this.eventAccess.assert(user, 'event:update', eventId);
    if (e.status === 'CANCELLED' || e.status === 'COMPLETED') throw Errors.invalidState('กิจกรรมนี้สิ้นสุดหรือถูกยกเลิกแล้ว');
  }

  private window(fromIso: string, toIso: string) {
    const from = new Date(fromIso);
    const to = new Date(toIso);
    if (!(to > from)) throw Errors.validation('เวลาสิ้นสุดต้องหลังเวลาเริ่ม');
    if (to.getTime() - from.getTime() > MAX_SPAN_MS) throw Errors.validation('ช่วงเวลายาวเกิน 31 วัน');
    return { from, to };
  }

  /** The EXCLUDE constraint (23P01) means another approval for the same room won the race. */
  private async mapConflict<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const code = (e as { code?: string; meta?: { code?: string } })?.meta?.code ?? (e as { code?: string })?.code;
      const text = String((e as Error)?.message ?? '');
      if (code === '23P01' || code === '40P01' || /venue_bookings_no_overlap|deadlock detected/i.test(text)) {
        throw new AppError('VENUE_CONFLICT', 'สถานที่ถูกจองในช่วงเวลานี้แล้ว (มีการอนุมัติรายการอื่นก่อน)', HttpStatus.CONFLICT);
      }
      throw e;
    }
  }

  private async lockVenue(tx: Tx, venueId: string) {
    await tx.$queryRaw`SELECT id FROM venues WHERE id = ${venueId}::uuid FOR UPDATE`;
  }

  private async unique<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw Errors.conflict('DUPLICATE_CODE', 'รหัสนี้ถูกใช้แล้ว');
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw Errors.notFound();
      throw e;
    }
  }
}
