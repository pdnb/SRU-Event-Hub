import { Injectable } from '@nestjs/common';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import type { RequestMeta } from '../common/decorators';
import { Errors } from '../common/errors';
import type { AuthUser } from '../auth/auth.types';
import { ApprovalStep, ApprovalTrigger, Event, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from '../events/events.service';

type Decision = 'APPROVE' | 'REJECT' | 'RETURN';

/**
 * Configurable multi-step approval (spec §4.4).
 *
 * Workflow selection: the nearest workflow defined on the event's organization
 * or its ancestors wins; otherwise the university-wide default (organization_id
 * NULL). A workflow flagged `for_paid_events` takes precedence for paid events.
 * Steps flagged `paid_events_only` (finance review) are skipped for free events.
 *
 * Every action is appended to approval_actions (append-only at DB level).
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  async submit(eventId: string, user: AuthUser, meta: RequestMeta, trigger: ApprovalTrigger = 'INITIAL') {
    const event = await this.events.findOrThrow(eventId);
    await this.events.assertCanManage(event, user, 'event:update');
    if (!['DRAFT', 'REJECTED'].includes(event.status)) {
      throw Errors.invalidState('เสนออนุมัติได้เฉพาะกิจกรรมฉบับร่างหรือที่ถูกส่งกลับแก้ไข');
    }
    const workflow = await this.selectWorkflow(event);
    const steps = this.applicableSteps(workflow.steps, event);
    if (!steps.length) throw Errors.invalidState('Workflow ไม่มีขั้นตอนที่ใช้กับกิจกรรมนี้');

    return this.prisma.$transaction(async (tx) => {
      const last = await tx.approvalRequest.findFirst({ where: { eventId }, orderBy: { round: 'desc' } });
      const request = await tx.approvalRequest.create({
        data: {
          eventId,
          workflowId: workflow.id,
          round: (last?.round ?? 0) + 1,
          trigger,
          status: 'PENDING',
          currentStepOrder: steps[0]!.stepOrder,
          submittedById: user.id,
        },
      });
      await tx.approvalAction.create({ data: { requestId: request.id, action: 'SUBMIT', actorId: user.id } });
      const res = await tx.event.updateMany({
        where: { id: eventId, status: event.status },
        data: { status: 'PENDING_APPROVAL', approvalStatus: 'PENDING', version: { increment: 1 } },
      });
      if (res.count !== 1) throw Errors.conflict('STATUS_CHANGED', 'สถานะกิจกรรมถูกเปลี่ยนโดยผู้อื่นแล้ว');
      await tx.eventStatusHistory.create({ data: { eventId, fromStatus: event.status, toStatus: 'PENDING_APPROVAL', changedById: user.id } });
      await this.audit.log({ actorId: user.id, action: 'approval.submit', entityType: 'event', entityId: eventId, after: { requestId: request.id, round: request.round, workflow: workflow.code }, meta }, tx);
      return { requestId: request.id, round: request.round, currentStep: steps[0]!.nameTh };
    });
  }

  async decide(eventId: string, decision: Decision, comment: string | undefined, user: AuthUser, meta: RequestMeta) {
    if (decision !== 'APPROVE' && !comment?.trim()) throw Errors.validation('กรุณาระบุเหตุผลประกอบการพิจารณา');

    const request = await this.prisma.approvalRequest.findFirst({
      where: { eventId, status: 'PENDING' },
      include: { event: true, workflow: { include: { steps: { orderBy: { stepOrder: 'asc' } } } } },
    });
    if (!request) throw Errors.invalidState('ไม่มีคำขออนุมัติที่รอพิจารณา');
    const steps = this.applicableSteps(request.workflow.steps, request.event);
    const step = steps.find((s) => s.stepOrder === request.currentStepOrder);
    if (!step) throw Errors.invalidState('ไม่พบขั้นตอนอนุมัติปัจจุบัน');

    // Separation of duties: the proposer can never approve their own event.
    if (request.submittedById === user.id || request.event.createdById === user.id) {
      throw Errors.forbidden('ผู้เสนอไม่สามารถพิจารณาอนุมัติกิจกรรมของตนเองได้');
    }
    if (!(await this.isApprover(step, request.event, user))) throw Errors.forbidden('ท่านไม่ใช่ผู้อนุมัติในขั้นตอนนี้');

    const next = steps.find((s) => s.stepOrder > step.stepOrder);
    const finalApprove = decision === 'APPROVE' && !next;

    return this.prisma.$transaction(async (tx) => {
      // Optimistic guard: only one approver can act on this step.
      const claimed = await tx.approvalRequest.updateMany({
        where: { id: request.id, status: 'PENDING', currentStepOrder: step.stepOrder },
        data:
          decision === 'APPROVE' && next
            ? { currentStepOrder: next.stepOrder }
            : {
                status: decision === 'APPROVE' ? 'APPROVED' : decision === 'REJECT' ? 'REJECTED' : 'RETURNED',
                currentStepOrder: null,
                completedAt: new Date(),
              },
      });
      if (claimed.count !== 1) throw Errors.conflict('ALREADY_DECIDED', 'ขั้นตอนนี้ถูกพิจารณาไปแล้ว');

      await tx.approvalAction.create({
        data: { requestId: request.id, stepId: step.id, stepOrder: step.stepOrder, action: decision, actorId: user.id, comment: comment?.trim() || null },
      });

      let toStatus: Event['status'] | null = null;
      let eventData: Prisma.EventUncheckedUpdateInput = {};
      if (finalApprove) {
        toStatus = 'APPROVED';
        eventData = { status: 'APPROVED', approvalStatus: 'APPROVED' };
      } else if (decision === 'REJECT') {
        toStatus = 'REJECTED';
        eventData = { status: 'REJECTED', approvalStatus: 'REJECTED' };
      } else if (decision === 'RETURN') {
        toStatus = 'DRAFT';
        eventData = { status: 'DRAFT', approvalStatus: 'RETURNED' };
      }
      if (toStatus) {
        await tx.event.update({ where: { id: eventId }, data: { ...eventData, version: { increment: 1 } } });
        await tx.eventStatusHistory.create({
          data: { eventId, fromStatus: 'PENDING_APPROVAL', toStatus, changedById: user.id, reason: comment?.trim() || null },
        });
      }
      await this.audit.log({
        actorId: user.id, action: `approval.${decision.toLowerCase()}`, entityType: 'event', entityId: eventId,
        after: { requestId: request.id, step: step.stepOrder, next: next?.stepOrder ?? null }, reason: comment, meta,
      }, tx);
      return {
        requestStatus: finalApprove ? 'APPROVED' : decision === 'APPROVE' ? 'PENDING' : decision === 'REJECT' ? 'REJECTED' : 'RETURNED',
        nextStep: decision === 'APPROVE' && next ? next.nameTh : null,
      };
    });
  }

  /** Requests waiting for the current user at their current step. */
  async pendingForUser(user: AuthUser) {
    const pending = await this.prisma.approvalRequest.findMany({
      where: { status: 'PENDING', event: { deletedAt: null } },
      include: {
        event: { include: { organization: { select: { nameTh: true } } } },
        workflow: { include: { steps: { orderBy: { stepOrder: 'asc' } } } },
        submittedBy: { select: { id: true, displayName: true } },
      },
      orderBy: { submittedAt: 'asc' },
      take: 500,
    });
    const mine = [];
    for (const r of pending) {
      const step = r.workflow.steps.find((s) => s.stepOrder === r.currentStepOrder);
      if (!step || r.submittedById === user.id || r.event.createdById === user.id) continue;
      if (await this.isApprover(step, r.event, user)) {
        mine.push({
          requestId: r.id,
          round: r.round,
          trigger: r.trigger,
          submittedAt: r.submittedAt,
          submittedBy: r.submittedBy,
          step: { order: step.stepOrder, nameTh: step.nameTh, isFinanceReview: step.isFinanceReview },
          event: {
            id: r.event.id,
            code: r.event.code,
            titleTh: r.event.titleTh,
            organizationName: r.event.organization.nameTh,
            startAt: r.event.startAt,
            isPaid: r.event.isPaid,
          },
        });
      }
    }
    return mine;
  }

  async history(eventId: string, user: AuthUser) {
    const event = await this.events.findOrThrow(eventId);
    await this.events.assertCanManage(event, user, 'event:view').catch(async (e) => {
      // Approvers may see history of events they are asked to approve.
      if (!this.access.has(user, 'approval:approve')) throw e;
    });
    return this.prisma.approvalRequest.findMany({
      where: { eventId },
      orderBy: { round: 'asc' },
      include: {
        workflow: { select: { code: true, nameTh: true, steps: { orderBy: { stepOrder: 'asc' }, select: { stepOrder: true, nameTh: true, isFinanceReview: true } } } },
        submittedBy: { select: { id: true, displayName: true } },
        actions: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { id: true, displayName: true } }, step: { select: { nameTh: true } } } },
      },
    });
  }

  // ───────────── internals ─────────────

  private async selectWorkflow(event: Event) {
    const chain = await this.access.ancestors(event.organizationId);
    const candidates = await this.prisma.approvalWorkflow.findMany({
      where: { isActive: true, OR: [{ organizationId: { in: chain.map((c) => c.id) } }, { organizationId: null }] },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    const depth = (orgId: string | null) => (orgId === null ? chain.length : chain.findIndex((c) => c.id === orgId));
    const ranked = candidates
      .filter((w) => !w.forPaidEvents || event.isPaid)
      .sort((a, b) => depth(a.organizationId) - depth(b.organizationId) || Number(b.forPaidEvents) - Number(a.forPaidEvents));
    const wf = ranked[0];
    if (!wf) throw Errors.invalidState('ยังไม่ได้กำหนด Workflow การอนุมัติ กรุณาติดต่อผู้ดูแลระบบ');
    return wf;
  }

  private applicableSteps(steps: ApprovalStep[], event: Pick<Event, 'isPaid'>) {
    return steps.filter((s) => !s.paidEventsOnly || event.isPaid).sort((a, b) => a.stepOrder - b.stepOrder);
  }

  private async isApprover(step: ApprovalStep, event: Pick<Event, 'organizationId'>, user: AuthUser): Promise<boolean> {
    switch (step.approverType) {
      case 'USER':
        return step.approverUserId === user.id;
      case 'ORG_HEAD': {
        const [self] = await this.access.ancestors(event.organizationId);
        return self?.headUserId === user.id;
      }
      case 'PARENT_ORG_HEAD': {
        const chain = await this.access.ancestors(event.organizationId);
        return chain[1]?.headUserId === user.id;
      }
      case 'ROLE': {
        if (!step.approverRoleId) return false;
        const role = await this.prisma.role.findUnique({ where: { id: step.approverRoleId }, select: { code: true } });
        const grants = user.grants.filter((g) => g.code === role?.code);
        if (!grants.length) return false;
        if (grants.some((g) => g.scope === 'ALL')) return true;
        const chainIds = (await this.access.ancestors(event.organizationId)).map((c) => c.id);
        return grants.some(
          (g) =>
            g.organizationId &&
            (g.organizationId === event.organizationId ||
              (g.scope === 'ORGANIZATION_TREE' && chainIds.includes(g.organizationId))),
        );
      }
    }
  }
}
