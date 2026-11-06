import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import type { RequestMeta } from '../common/decorators';
import { Errors } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { PersonnelDto, PersonnelUpdateDto } from './checkin.dto';
import { EventAccessService } from './event-access.service';

/**
 * Event personnel: speakers, staff, VIPs … who need a badge but are not registrants. A personnel
 * entry linked to a user account with `canCheckin` lets that user run a check-in desk for this
 * event (with the check-in permissions their role grants), without organization-wide rights.
 */
@Injectable()
export class PersonnelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: EventAccessService,
  ) {}

  async list(eventId: string, user: AuthUser) {
    await this.access.assert(user, 'badge:view', eventId);
    const rows = await this.prisma.eventPersonnel.findMany({
      where: { eventId, deletedAt: null },
      include: { user: { select: { id: true, displayName: true, email: true } }, _count: { select: { prints: true } } },
      orderBy: [{ role: 'asc' }, { firstName: 'asc' }],
    });
    return rows.map(({ _count, ...p }) => ({ ...p, badgePrints: _count.prints }));
  }

  async create(eventId: string, dto: PersonnelDto, user: AuthUser, meta: RequestMeta) {
    await this.access.assert(user, 'event:update', eventId);
    await this.assertUser(dto.userId, dto.canCheckin);
    const p = await this.prisma.eventPersonnel.create({
      data: {
        eventId, role: dto.role, userId: dto.userId ?? null, prefix: dto.prefix, firstName: dto.firstName.trim(), lastName: dto.lastName.trim(),
        position: dto.position, affiliation: dto.affiliation, email: dto.email, phone: dto.phone, canCheckin: dto.canCheckin ?? false, createdById: user.id,
      },
    });
    await this.audit.log({ actorId: user.id, action: 'event_personnel.create', entityType: 'event_personnel', entityId: p.id, after: { eventId, role: p.role, userId: p.userId, canCheckin: p.canCheckin }, meta });
    return p;
  }

  async update(id: string, dto: PersonnelUpdateDto, user: AuthUser, meta: RequestMeta) {
    const p = await this.load(id);
    await this.access.assert(user, 'event:update', p.eventId);
    const userId = dto.userId !== undefined ? dto.userId : p.userId;
    await this.assertUser(userId, dto.canCheckin ?? p.canCheckin);
    const next = await this.prisma.eventPersonnel.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.firstName ? { firstName: dto.firstName.trim() } : {}),
        ...(dto.lastName ? { lastName: dto.lastName.trim() } : {}),
      },
    });
    await this.audit.log({ actorId: user.id, action: 'event_personnel.update', entityType: 'event_personnel', entityId: id, before: { role: p.role, userId: p.userId, canCheckin: p.canCheckin }, after: { role: next.role, userId: next.userId, canCheckin: next.canCheckin }, meta });
    return next;
  }

  /** Soft delete: printed badges keep pointing at the row. */
  async remove(id: string, user: AuthUser, meta: RequestMeta) {
    const p = await this.load(id);
    await this.access.assert(user, 'event:update', p.eventId);
    await this.prisma.eventPersonnel.update({ where: { id }, data: { deletedAt: new Date(), canCheckin: false } });
    await this.audit.log({ actorId: user.id, action: 'event_personnel.delete', entityType: 'event_personnel', entityId: id, meta });
    return { deleted: true };
  }

  /** Finds an account by exact e-mail to link as personnel (no user directory browsing needed). */
  async lookupUser(eventId: string, email: string, user: AuthUser) {
    await this.access.assert(user, 'event:update', eventId);
    const u = await this.prisma.user.findFirst({
      where: { email: { equals: email.trim(), mode: 'insensitive' }, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, displayName: true, email: true },
    });
    return u ?? null;
  }

  private async load(id: string) {
    const p = await this.prisma.eventPersonnel.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw Errors.notFound('บุคลากรของกิจกรรม');
    return p;
  }

  private async assertUser(userId: string | null | undefined, canCheckin: boolean | undefined) {
    if (canCheckin && !userId) throw Errors.validation('ต้องเลือกบัญชีผู้ใช้ก่อนมอบสิทธิ์เช็กอิน');
    if (!userId) return;
    const u = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null, status: 'ACTIVE' }, select: { id: true } });
    if (!u) throw Errors.validation('ไม่พบบัญชีผู้ใช้');
  }
}
