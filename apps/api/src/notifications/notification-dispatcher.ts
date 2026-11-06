import { Injectable, Logger } from '@nestjs/common';
import { formatThaiDateTime } from '@sru/shared-utils';
import { AccessService } from '../common/access.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

type Audit = { id: string; action: string; entityType: string; entityId: string | null; actorId: string | null; after: Prisma.JsonValue; reason: string | null; createdAt: Date };
type Handler = (a: Audit) => Promise<void>;

const LOOKBACK_MS = 15 * 60_000;
const ACTIVE_REG = ['PENDING_PAYMENT', 'CONFIRMED', 'WAITLISTED'] as const;
const DECISION_TH: Record<string, string> = { approve: 'ได้รับอนุมัติแล้ว', reject: 'ไม่ได้รับอนุมัติ', return: 'ถูกส่งกลับให้แก้ไข' };

const obj = (v: Prisma.JsonValue): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const when = (a: Date, b: Date) => `${formatThaiDateTime(a)} – ${formatThaiDateTime(b)}`;

/**
 * Turns business facts into notifications. Every business action already writes an audit row
 * inside its own transaction, so reading *committed* audit rows means notifications are only sent
 * for work that really happened (never for a rolled-back request) and no service needs to know
 * about notifications.
 *
 * Each run scans the last 15 minutes (late commits of long transactions are still seen), skips rows
 * already marked in `notification_dispatches`, and marks a row after its handler ran. Two workers
 * may process the same row at the same time — every notification carries the dedupe key
 * `audit:<id>`, so nothing is delivered twice.
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);
  private readonly handlers: Record<string, Handler>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationsService,
    private readonly access: AccessService,
  ) {
    this.handlers = {
      'registration.create': (a) => this.registrationCreated(a),
      'registration.cancel': (a) => this.waitlistPromoted(a),
      'payment.verify': (a) => this.paymentDecided(a, true),
      'payment.reject': (a) => this.paymentDecided(a, false),
      'event.status.cancelled': (a) => this.eventCancelled(a),
      'event.reschedule': (a) => this.eventRescheduled(a),
      'approval.submit': (a) => this.approvalPending(a),
      'approval.fee_change.submit': (a) => this.approvalPending(a),
      'approval.approve': (a) => this.approvalDecided(a, 'approve'),
      'approval.reject': (a) => this.approvalDecided(a, 'reject'),
      'approval.return': (a) => this.approvalDecided(a, 'return'),
      'approval.fee_change.approve': (a) => this.approvalDecided(a, 'approve'),
      'approval.fee_change.reject': (a) => this.approvalDecided(a, 'reject'),
      'approval.fee_change.return': (a) => this.approvalDecided(a, 'return'),
      'venue_booking.request': (a) => this.bookingPending(a, 'venue'),
      'resource_booking.request': (a) => this.bookingPending(a, 'resource'),
      'venue_booking.approve': (a) => this.bookingDecided(a, 'venue', true),
      'venue_booking.reject': (a) => this.bookingDecided(a, 'venue', false),
      'resource_booking.approve': (a) => this.bookingDecided(a, 'resource', true),
      'resource_booking.reject': (a) => this.bookingDecided(a, 'resource', false),
      'certificate.issue': (a) => this.certificatesIssued(a),
      'certificate.issue_override': (a) => this.certificatesIssued(a),
      'evaluation_form.publish': (a) => this.evaluationOpen(a),
    };
  }

  /** One pass. `settleMs` skips the newest rows (their transaction may still be committing). */
  async runOnce(opts: { settleMs?: number } = {}): Promise<number> {
    const settle = opts.settleMs ?? 2000;
    const rows = await this.prisma.$queryRaw<Audit[]>`
      SELECT a.id::text AS id, a.action, a.entity_type AS "entityType", a.entity_id AS "entityId", a.actor_id::text AS "actorId", a.after, a.reason, a.created_at AS "createdAt"
      FROM audit_logs a
      LEFT JOIN notification_dispatches d ON d.audit_log_id = a.id
      WHERE d.audit_log_id IS NULL
        AND a.created_at > now() - ${`${LOOKBACK_MS} milliseconds`}::interval
        AND a.created_at <= now() - ${`${settle} milliseconds`}::interval
        AND a.action = ANY(${Object.keys(this.handlers)})
      ORDER BY a.created_at
      LIMIT 500`;
    let done = 0;
    for (const a of rows) {
      try {
        await this.handlers[a.action]!(a);
      } catch (e) {
        // A broken handler must not block the others; the row is still marked so it is not retried forever.
        this.logger.error({ audit: a.id, action: a.action, err: String((e as Error)?.stack ?? e) }, 'Notification handler failed');
      }
      await this.prisma.notificationDispatch.createMany({ data: [{ auditLogId: a.id }], skipDuplicates: true });
      done++;
    }
    return done;
  }

  /** Day-before reminder for confirmed registrants (once per registration). */
  async reminders(now = new Date()): Promise<number> {
    const regs = await this.prisma.registration.findMany({
      where: {
        status: 'CONFIRMED',
        createdAt: { lt: new Date(now.getTime() - 2 * 3600_000) },
        event: { deletedAt: null, status: { notIn: ['CANCELLED', 'COMPLETED', 'DRAFT'] }, startAt: { gt: now, lte: new Date(now.getTime() + 24 * 3600_000) } },
      },
      select: { id: true, userId: true, email: true, prefix: true, firstName: true, lastName: true, referenceNo: true, event: { select: { titleTh: true, code: true, startAt: true, endAt: true, venueText: true } } },
      take: 2000,
    });
    let n = 0;
    for (const r of regs) {
      n += await this.notify.notify({
        code: 'EVENT_REMINDER',
        dedupe: `reminder:${r.id}`,
        recipients: [{ userId: r.userId, email: r.email, name: fullName(r) }],
        vars: { ...this.eventVars(r.event), referenceNo: r.referenceNo },
        link: r.userId ? '/my/registrations' : '/registration/status',
      });
    }
    return n;
  }

  // ───────────── handlers ─────────────

  private async registrationCreated(a: Audit) {
    const r = await this.registration(a.entityId);
    if (!r || r.groupId) return; // group members hear from their coordinator
    const status = String(obj(a.after).status ?? r.status);
    const code = status === 'CONFIRMED' ? 'REGISTRATION_CONFIRMED' : status === 'WAITLISTED' ? 'REGISTRATION_WAITLISTED' : status === 'PENDING_PAYMENT' ? 'REGISTRATION_PENDING_PAYMENT' : null;
    if (!code) return;
    await this.notify.notify({
      code, dedupe: `audit:${a.id}`,
      recipients: [{ userId: r.userId, email: r.email, name: fullName(r) }],
      vars: { ...this.eventVars(r.event), referenceNo: r.referenceNo, dueAt: r.paymentDueAt ? formatThaiDateTime(r.paymentDueAt) : '' },
      link: r.userId ? '/my/registrations' : null,
    });
  }

  private async waitlistPromoted(a: Audit) {
    const ids = (obj(a.after).promoted as string[] | undefined) ?? [];
    for (const id of ids) {
      const r = await this.registration(id);
      if (!r) continue;
      await this.notify.notify({
        code: 'WAITLIST_PROMOTED', dedupe: `audit:${a.id}:${id}`,
        recipients: [{ userId: r.userId, email: r.email, name: fullName(r) }],
        vars: { ...this.eventVars(r.event), referenceNo: r.referenceNo, extra: r.status === 'PENDING_PAYMENT' && r.paymentDueAt ? `กรุณาชำระเงินภายใน ${formatThaiDateTime(r.paymentDueAt)}` : '' },
        link: r.userId ? '/my/registrations' : null,
      });
    }
  }

  private async paymentDecided(a: Audit, ok: boolean) {
    if (!a.entityId) return;
    const p = await this.prisma.payment.findUnique({
      where: { id: a.entityId },
      select: {
        amount: true,
        order: {
          select: {
            dueAt: true,
            registration: { select: { userId: true, email: true, prefix: true, firstName: true, lastName: true, referenceNo: true, event: { select: EVENT_SELECT } } },
            group: { select: { groupNo: true, coordinatorUserId: true, event: { select: EVENT_SELECT } } },
          },
        },
      },
    });
    if (!p) return;
    const reg = p.order.registration;
    const grp = p.order.group;
    const event = reg?.event ?? grp?.event;
    if (!event) return;
    await this.notify.notify({
      code: ok ? 'PAYMENT_VERIFIED' : 'PAYMENT_REJECTED', dedupe: `audit:${a.id}`,
      recipients: reg ? [{ userId: reg.userId, email: reg.email, name: fullName(reg) }] : [{ userId: grp!.coordinatorUserId }],
      vars: { ...this.eventVars(event), referenceNo: reg?.referenceNo ?? grp?.groupNo ?? '', amount: p.amount.toFixed(2), reason: a.reason ?? '', dueAt: p.order.dueAt ? formatThaiDateTime(p.order.dueAt) : '' },
      link: reg ? (reg.userId ? '/my/registrations' : null) : '/my/groups',
    });
  }

  private async eventCancelled(a: Audit) {
    if (!a.entityId) return;
    const regs = await this.prisma.registration.findMany({
      where: { eventId: a.entityId, status: 'CANCELLED', cancelReason: 'กิจกรรมถูกยกเลิก' },
      select: { userId: true, email: true, prefix: true, firstName: true, lastName: true, referenceNo: true, event: { select: EVENT_SELECT } },
    });
    for (const r of regs) {
      await this.notify.notify({
        code: 'EVENT_CANCELLED', dedupe: `audit:${a.id}:${r.referenceNo}`,
        recipients: [{ userId: r.userId, email: r.email, name: fullName(r) }],
        vars: { ...this.eventVars(r.event), referenceNo: r.referenceNo, reason: a.reason ?? '' },
        link: r.userId ? '/my/registrations' : null,
      });
    }
  }

  private async eventRescheduled(a: Audit) {
    if (!a.entityId) return;
    const regs = await this.prisma.registration.findMany({
      where: { eventId: a.entityId, status: { in: [...ACTIVE_REG] } },
      select: { userId: true, email: true, prefix: true, firstName: true, lastName: true, referenceNo: true, event: { select: EVENT_SELECT } },
    });
    for (const r of regs) {
      await this.notify.notify({
        code: 'EVENT_RESCHEDULED', dedupe: `audit:${a.id}:${r.referenceNo}`,
        recipients: [{ userId: r.userId, email: r.email, name: fullName(r) }],
        vars: { ...this.eventVars(r.event), referenceNo: r.referenceNo, reason: a.reason ?? '' },
        link: r.userId ? '/my/registrations' : null,
      });
    }
  }

  private async approvalPending(a: Audit) {
    if (!a.entityId) return;
    const req = await this.prisma.approvalRequest.findFirst({
      where: { eventId: a.entityId, status: 'PENDING' },
      orderBy: { submittedAt: 'desc' },
      select: { currentStepOrder: true, workflowId: true, event: { select: { ...EVENT_SELECT, organizationId: true, isPaid: true } } },
    });
    if (!req?.currentStepOrder) return;
    await this.notifyApprovers(a, req.workflowId, req.currentStepOrder, req.event);
  }

  private async approvalDecided(a: Audit, decision: 'approve' | 'reject' | 'return') {
    if (!a.entityId) return;
    const next = obj(a.after).next as number | null | undefined;
    const e = await this.prisma.event.findUnique({ where: { id: a.entityId }, select: { ...EVENT_SELECT, organizationId: true, isPaid: true, ownerUserId: true, createdById: true } });
    if (!e) return;
    if (decision === 'approve' && next) {
      const req = await this.prisma.approvalRequest.findFirst({ where: { eventId: e.id, status: 'PENDING' }, orderBy: { submittedAt: 'desc' }, select: { workflowId: true } });
      if (req) await this.notifyApprovers(a, req.workflowId, next, e);
      return;
    }
    await this.notify.notify({
      code: 'APPROVAL_DECIDED', dedupe: `audit:${a.id}`,
      recipients: [...new Set([e.ownerUserId, e.createdById])].map((userId) => ({ userId })),
      vars: { ...this.eventVars(e), decision: a.action.includes('fee_change') ? `(แก้ไขอัตราค่าลงทะเบียน) ${DECISION_TH[decision]}` : DECISION_TH[decision], reason: a.reason ? `— ${a.reason}` : '' },
      link: `/admin/events/${e.id}`,
    });
  }

  private async bookingPending(a: Audit, kind: 'venue' | 'resource') {
    const b = await this.booking(kind, a.entityId);
    if (!b) return;
    const approvers = (await this.usersWithPermission('venue:approve', b.organizationId)).filter((id) => id !== b.requestedById);
    await this.notify.notify({
      code: 'BOOKING_PENDING', dedupe: `audit:${a.id}`,
      recipients: approvers.map((userId) => ({ userId })),
      vars: { kind: kind === 'venue' ? 'สถานที่' : 'อุปกรณ์', resourceName: b.name, requester: b.requester ?? '', when: when(b.startAt, b.endAt), purpose: b.purpose ? `เพื่อ ${b.purpose}` : '' },
      link: '/admin/venues?tab=approve',
    });
  }

  private async bookingDecided(a: Audit, kind: 'venue' | 'resource', ok: boolean) {
    const b = await this.booking(kind, a.entityId);
    if (!b?.requestedById) return;
    await this.notify.notify({
      code: 'BOOKING_DECIDED', dedupe: `audit:${a.id}`,
      recipients: [{ userId: b.requestedById }],
      vars: { kind: kind === 'venue' ? 'สถานที่' : 'อุปกรณ์', resourceName: b.name, when: when(b.startAt, b.endAt), decision: ok ? 'ได้รับอนุมัติแล้ว' : 'ไม่ได้รับอนุมัติ', reason: a.reason ? `— ${a.reason}` : '' },
      link: '/admin/venues?tab=mine',
    });
  }

  private async certificatesIssued(a: Audit) {
    const ids = (obj(a.after).ids as string[] | undefined) ?? [];
    if (!ids.length) return;
    const certs = await this.prisma.certificate.findMany({
      where: { id: { in: ids }, status: 'ISSUED' },
      select: { id: true, certificateNo: true, recipientName: true, event: { select: EVENT_SELECT }, registration: { select: { userId: true, email: true } }, personnel: { select: { userId: true, email: true } } },
    });
    for (const c of certs) {
      const who = c.registration ?? c.personnel;
      if (!who) continue;
      await this.notify.notify({
        code: 'CERTIFICATE_ISSUED', dedupe: `audit:${a.id}:${c.id}`,
        recipients: [{ userId: who.userId, email: who.email, name: c.recipientName }],
        vars: { ...this.eventVars(c.event), certificateNo: c.certificateNo },
        link: who.userId ? '/my/certificates' : '/registration/status',
      });
    }
  }

  private async evaluationOpen(a: Audit) {
    if (!a.entityId) return;
    const f = await this.prisma.evaluationForm.findUnique({ where: { id: a.entityId }, select: { id: true, titleTh: true, requireAttendance: true, opensAt: true, closesAt: true, event: { select: { ...EVENT_SELECT, id: true } } } });
    if (!f) return;
    const opens = f.opensAt ?? f.event.startAt;
    if (opens > new Date()) return; // not open yet — participants see it after the event starts
    const regs = await this.prisma.registration.findMany({
      where: { eventId: f.event.id, status: 'CONFIRMED', ...(f.requireAttendance ? { attendance: { some: { scheduleId: null, status: { in: ['PRESENT', 'LATE'] } } } } : {}) },
      select: { id: true, userId: true, email: true, prefix: true, firstName: true, lastName: true },
      take: 5000,
    });
    for (const r of regs) {
      await this.notify.notify({
        code: 'EVALUATION_OPEN', dedupe: `audit:${a.id}:${r.id}`,
        recipients: [{ userId: r.userId, email: r.email, name: fullName(r) }],
        vars: { ...this.eventVars(f.event), formTitle: f.titleTh, extra: f.closesAt ? `ภายใน ${formatThaiDateTime(f.closesAt)}` : '' },
        link: r.userId ? `/my/evaluations/${f.id}?registrationId=${r.id}` : '/registration/status',
      });
    }
  }

  // ───────────── recipients ─────────────

  private async notifyApprovers(a: Audit, workflowId: string, stepOrder: number, e: { id: string; organizationId: string } & EventRow) {
    const step = await this.prisma.approvalStep.findUnique({ where: { workflowId_stepOrder: { workflowId, stepOrder } }, include: { approverRole: { select: { id: true } } } });
    if (!step) return;
    let users: string[] = [];
    if (step.approverType === 'USER' && step.approverUserId) users = [step.approverUserId];
    else if (step.approverType === 'ORG_HEAD' || step.approverType === 'PARENT_ORG_HEAD') {
      const chain = await this.access.ancestors(e.organizationId);
      const head = chain[step.approverType === 'ORG_HEAD' ? 0 : 1]?.headUserId;
      users = head ? [head] : [];
    } else if (step.approverType === 'ROLE' && step.approverRoleId) {
      users = await this.usersWithRoleCovering(step.approverRoleId, e.organizationId);
    }
    await this.notify.notify({
      code: 'APPROVAL_PENDING', dedupe: `audit:${a.id}:step${stepOrder}`,
      recipients: users.filter((u) => u !== a.actorId).map((userId) => ({ userId })),
      vars: { ...this.eventVars(e), step: step.nameTh },
      link: '/admin/approvals',
    });
  }

  /** Active users holding `code` through a grant that covers `organizationId` (null = needs ALL scope). */
  async usersWithPermission(code: string, organizationId: string | null): Promise<string[]> {
    const chain = organizationId ? (await this.access.ancestors(organizationId)).map((c) => c.id) : [];
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT ur.user_id::text AS id
      FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
      JOIN users u ON u.id = ur.user_id
      WHERE p.code = ${code} AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
        AND (ur.scope = 'ALL'
          OR (${organizationId}::uuid IS NOT NULL AND ur.organization_id = ${organizationId}::uuid AND ur.scope IN ('ORGANIZATION', 'ORGANIZATION_TREE'))
          OR (ur.scope = 'ORGANIZATION_TREE' AND ur.organization_id = ANY(${chain}::uuid[])))
      LIMIT 200`;
    return rows.map((r) => r.id);
  }

  private async usersWithRoleCovering(roleId: string, organizationId: string): Promise<string[]> {
    const chain = (await this.access.ancestors(organizationId)).map((c) => c.id);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT ur.user_id::text AS id
      FROM user_roles ur JOIN users u ON u.id = ur.user_id
      WHERE ur.role_id = ${roleId}::uuid AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
        AND (ur.scope = 'ALL' OR ur.organization_id = ${organizationId}::uuid
          OR (ur.scope = 'ORGANIZATION_TREE' AND ur.organization_id = ANY(${chain}::uuid[])))
      LIMIT 200`;
    return rows.map((r) => r.id);
  }

  private registration(id: string | null) {
    if (!id) return null;
    return this.prisma.registration.findUnique({
      where: { id },
      select: { id: true, userId: true, email: true, prefix: true, firstName: true, lastName: true, referenceNo: true, status: true, groupId: true, paymentDueAt: true, event: { select: EVENT_SELECT } },
    });
  }

  private async booking(kind: 'venue' | 'resource', id: string | null) {
    if (!id) return null;
    if (kind === 'venue') {
      const b = await this.prisma.venueBooking.findUnique({ where: { id }, select: { startAt: true, endAt: true, purpose: true, requestedById: true, requestedBy: { select: { displayName: true } }, venue: { select: { nameTh: true, organizationId: true } }, event: { select: { titleTh: true } } } });
      return b && { startAt: b.startAt, endAt: b.endAt, purpose: b.event?.titleTh ?? b.purpose, requestedById: b.requestedById, requester: b.requestedBy.displayName, name: b.venue.nameTh, organizationId: b.venue.organizationId };
    }
    const b = await this.prisma.resourceBooking.findUnique({ where: { id }, select: { startAt: true, endAt: true, quantity: true, purpose: true, requestedById: true, requestedBy: { select: { displayName: true } }, resource: { select: { nameTh: true, organizationId: true } }, event: { select: { titleTh: true } } } });
    return b && { startAt: b.startAt, endAt: b.endAt, purpose: b.event?.titleTh ?? b.purpose, requestedById: b.requestedById, requester: b.requestedBy?.displayName, name: `${b.resource.nameTh} × ${b.quantity}`, organizationId: b.resource.organizationId };
  }

  private eventVars(e: EventRow) {
    return { eventTitle: e.titleTh, eventCode: e.code, eventDate: when(e.startAt, e.endAt), venue: e.venueText ?? '-' };
  }
}

const EVENT_SELECT = { id: true, titleTh: true, code: true, startAt: true, endAt: true, venueText: true } as const;
type EventRow = { titleTh: string; code: string; startAt: Date; endAt: Date; venueText: string | null };
const fullName = (r: { prefix: string | null; firstName: string; lastName: string }) => `${r.prefix ?? ''}${r.firstName} ${r.lastName}`.trim();
