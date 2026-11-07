import { Injectable } from '@nestjs/common';
import type { PermissionCode } from '@sru/shared-types';
import { ApprovalsService } from '../approvals/approvals.service';
import type { AuthUser } from '../auth/auth.types';
import { AccessService } from '../common/access.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface DashboardTask {
  key: string;
  label: string;
  count: number;
  href: string;
  /** warn = needs a decision by someone else; info = housekeeping */
  tone: 'action' | 'warn' | 'info';
}

/**
 * Role-aware "waiting for you" list for the admin dashboard. Each task is shown only when the user
 * holds the permission, and counts only records inside that permission's data scope — the same
 * rules the target pages apply, so a count always matches what the link shows.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly approvals: ApprovalsService,
  ) {}

  async tasks(user: AuthUser): Promise<DashboardTask[]> {
    const now = new Date();
    const out: DashboardTask[] = [];
    const add = (t: DashboardTask) => {
      if (t.count > 0) out.push(t);
    };
    const run: Promise<void>[] = [];
    const can = (c: PermissionCode) => this.access.has(user, c);

    if (can('approval:approve')) {
      run.push(this.approvals.pendingForUser(user).then((p) => add({ key: 'approvals', label: 'กิจกรรมรอท่านพิจารณาอนุมัติ', count: p.length, href: '/admin/approvals', tone: 'action' })));
    }
    if (can('event:update')) {
      run.push(
        this.prisma.event
          .count({ where: { deletedAt: null, OR: [{ ownerUserId: user.id }, { createdById: user.id }], approvalStatus: 'RETURNED', status: 'DRAFT' } })
          .then((n) => add({ key: 'returned', label: 'กิจกรรมของท่านถูกส่งกลับให้แก้ไข', count: n, href: '/admin/events?status=DRAFT', tone: 'action' })),
      );
    }
    if (can('payment:verify')) {
      run.push(
        this.eventWhere(user, 'payment:verify').then((ev) =>
          this.prisma.payment
            .count({ where: { status: 'SUBMITTED', order: { event: ev } } })
            .then((n) => add({ key: 'slips', label: 'หลักฐานการโอนรอตรวจสอบ', count: n, href: '/admin/finance/payments', tone: 'action' })),
        ),
      );
    }
    if (can('cashier:approve')) {
      run.push(
        this.eventWhere(user, 'cashier:approve').then((ev) =>
          this.prisma.cashierSession
            .count({ where: { status: 'REMITTED', event: ev } })
            .then((n) => add({ key: 'cashier', label: 'กะรับเงินหน้างานรอยืนยันยอด', count: n, href: '/admin/finance/cashier', tone: 'action' })),
        ),
      );
    }
    if (can('finance_batch:receive')) {
      run.push(
        this.orgWhere(user, 'finance_batch:receive').then((org) =>
          this.prisma.financeBatch
            .count({ where: { status: 'SUBMITTED', ...org } })
            .then((n) => add({ key: 'batches', label: 'ชุดนำส่งรอกองคลังรับ', count: n, href: '/admin/finance/batches', tone: 'action' })),
        ),
      );
    }
    if (can('refund:approve') || can('refund:refund')) {
      const statuses = [...(can('refund:approve') ? (['REQUESTED'] as const) : []), ...(can('refund:refund') ? (['APPROVED'] as const) : [])];
      run.push(
        this.eventWhere(user, can('refund:approve') ? 'refund:approve' : 'refund:refund').then((ev) =>
          this.prisma.refund
            .count({ where: { status: { in: [...statuses] }, order: { event: ev } } })
            .then((n) => add({ key: 'refunds', label: 'คำขอคืนเงินรอดำเนินการ', count: n, href: '/admin/finance/refunds', tone: 'action' })),
        ),
      );
    }
    if (can('venue:approve')) {
      run.push(
        this.orgWhere(user, 'venue:approve').then(async (org) => {
          const [v, r] = await Promise.all([
            this.prisma.venueBooking.count({ where: { status: 'PENDING', requestedById: { not: user.id }, venue: org } }),
            this.prisma.resourceBooking.count({ where: { status: 'PENDING', OR: [{ requestedById: null }, { requestedById: { not: user.id } }], resource: org } }),
          ]);
          add({ key: 'bookings', label: 'คำขอจองสถานที่/อุปกรณ์รอพิจารณา', count: v + r, href: '/admin/venues?tab=approve', tone: 'action' });
        }),
      );
    }
    if (can('participant_org:approve')) {
      run.push(
        this.prisma.participantOrganization
          .count({ where: { verifiedAt: null, deletedAt: null } })
          .then((n) => add({ key: 'orgs', label: 'องค์กรผู้ส่งเข้าร่วมยังไม่ได้ตรวจสอบ', count: n, href: '/admin/participant-orgs', tone: 'info' })),
      );
    }
    if (can('checkin:view')) {
      run.push(
        this.eventWhere(user, 'checkin:view').then((ev) =>
          this.prisma.event
            .count({ where: { ...ev, deletedAt: null, status: { in: ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS'] }, startAt: { lte: new Date(now.getTime() + 2 * 3600_000) }, endAt: { gte: now } } })
            .then((n) => add({ key: 'checkin', label: 'กิจกรรมที่เปิดจุดเช็กอินได้ขณะนี้', count: n, href: '/admin/checkin', tone: 'info' })),
        ),
      );
    }
    if (can('certificate:create')) {
      run.push(
        this.eventWhere(user, 'certificate:create').then((ev) =>
          this.prisma.event
            .count({ where: { ...ev, deletedAt: null, status: { not: 'CANCELLED' }, endAt: { lt: now, gte: new Date(now.getTime() - 30 * 86400_000) }, registrations: { some: { status: 'CONFIRMED' } }, certificateTemplates: { none: { isActive: true } } } })
            .then((n) => add({ key: 'certificates', label: 'กิจกรรมที่จบแล้วแต่ยังไม่มีแม่แบบเกียรติบัตร (30 วัน)', count: n, href: '/admin/certificates', tone: 'info' })),
        ),
      );
    }
    if (can('evaluation:create')) {
      run.push(
        this.eventWhere(user, 'evaluation:create').then((ev) =>
          this.prisma.event
            .count({ where: { ...ev, deletedAt: null, status: { not: 'CANCELLED' }, startAt: { lt: now }, endAt: { gte: new Date(now.getTime() - 30 * 86400_000) }, evaluationForms: { none: { status: { in: ['PUBLISHED', 'CLOSED'] } } } } })
            .then((n) => add({ key: 'evaluations', label: 'กิจกรรมที่เริ่มแล้วแต่ยังไม่เผยแพร่แบบประเมิน (30 วัน)', count: n, href: '/admin/evaluations', tone: 'info' })),
        ),
      );
    }
    await Promise.all(run);
    const order = ['approvals', 'returned', 'slips', 'cashier', 'batches', 'refunds', 'bookings', 'checkin', 'certificates', 'evaluations', 'orgs'];
    return out.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  }

  /** Event filter for a permission's data scope (OWN → own events). */
  private async eventWhere(user: AuthUser, code: PermissionCode): Promise<Prisma.EventWhereInput> {
    if (this.access.ownOnly(user, code)) return { OR: [{ ownerUserId: user.id }, { createdById: user.id }] };
    const scope = await this.access.orgScope(user, code);
    return scope === 'ALL' ? {} : { organizationId: { in: scope } };
  }

  /** Organization filter (rows without an organization — central items — only match ALL scope). */
  private async orgWhere(user: AuthUser, code: PermissionCode): Promise<{ organizationId?: { in: string[] } }> {
    const scope = await this.access.orgScope(user, code);
    return scope === 'ALL' ? {} : { organizationId: { in: scope } };
  }
}
