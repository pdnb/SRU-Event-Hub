import { Injectable } from '@nestjs/common';
import type { PermissionCode } from '@sru/shared-types';
import type { AuthUser } from '../auth/auth.types';
import { AccessService } from '../common/access.service';
import { Errors } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

export interface ScopedEvent {
  id: string;
  code: string;
  titleTh: string;
  organizationId: string;
  ownerUserId: string;
  createdById: string;
  status: string;
  startAt: Date;
  endAt: Date;
  venueText: string | null;
  checkinOpensBeforeMinutes: number;
  checkinLateAfterMinutes: number | null;
}

const SELECT = {
  id: true,
  code: true,
  titleTh: true,
  organizationId: true,
  ownerUserId: true,
  createdById: true,
  status: true,
  startAt: true,
  endAt: true,
  venueText: true,
  checkinOpensBeforeMinutes: true,
  checkinLateAfterMinutes: true,
} as const;

/**
 * Data scope for check-in, attendance and badges (spec §5). A user acts on an event when they hold
 * the permission with a scope covering the event's organization (OWN scope → own events only).
 * In addition, staff assigned to the event as personnel with `can_checkin` may use the check-in
 * permissions they hold for that event only — e.g. a volunteer from another faculty at the desk.
 */
@Injectable()
export class EventAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async event(eventId: string): Promise<ScopedEvent> {
    const e = await this.prisma.event.findFirst({ where: { id: eventId, deletedAt: null }, select: SELECT });
    if (!e) throw Errors.notFound('กิจกรรม');
    return e;
  }

  async can(user: AuthUser, code: PermissionCode, e: ScopedEvent): Promise<boolean> {
    if (!this.access.has(user, code)) return false;
    if (this.access.ownOnly(user, code)) {
      if (e.ownerUserId === user.id || e.createdById === user.id) return true;
    } else if (await this.access.canOnOrg(user, code, e.organizationId)) {
      return true;
    }
    if (code.startsWith('checkin:') || code === 'attendance:view' || code === 'badge:print' || code === 'badge:view') {
      const assigned = await this.prisma.eventPersonnel.findFirst({
        where: { eventId: e.id, userId: user.id, canCheckin: true, deletedAt: null },
        select: { id: true },
      });
      return !!assigned;
    }
    return false;
  }

  async assert(user: AuthUser, code: PermissionCode, eventOrId: string | ScopedEvent): Promise<ScopedEvent> {
    const e = typeof eventOrId === 'string' ? await this.event(eventOrId) : eventOrId;
    if (!(await this.can(user, code, e))) throw Errors.forbidden();
    return e;
  }
}
