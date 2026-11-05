import { Injectable } from '@nestjs/common';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import type { RequestMeta } from '../common/decorators';
import { Errors } from '../common/errors';
import type { AuthUser } from '../auth/auth.types';
import { ApprovalStep, ApprovalTrigger, Event, EventStatus, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FeeChangeDto } from '../events/events.dto';
import { EventsService, FeeChangePayload } from '../events/events.service';
import { moneyIn } from '../common/money';

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
 *
 * FEE_CHANGE (spec §4.4): once approved, fee rates / receiving account / income code change only
 * through a new approval round. The proposal is stored on the request and applied on final
 * approval; meanwhile the event keeps its status and registrations continue at the current rates.
 * Orders issued before the change keep their own amount snapshot.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  /** Statuses in which an approved event may have its fees changed by re-approval. */
  private static readonly FEE_CHANGE_STATUSES: EventStatus[] = ['APPROVED', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS'];

  async requestFeeChange(eventId: string, dto: FeeChangeDto, user: AuthUser, meta: RequestMeta) {
    const event = await this.events.findOrThrow(eventId);
    await this.events.assertCanManage(event, user, 'event:update');
    if (['DRAFT', 'REJECTED'].includes(event.status)) throw Errors.invalidState('กิจกรรมยังไม่ได้รับอนุมัติ แก้ไขอัตราได้โดยตรงที่หน้าแก้ไขกิจกรรม');
    if (!ApprovalsService.FEE_CHANGE_STATUSES.includes(event.status)) throw Errors.invalidState('ไม่สามารถขอแก้ไขอัตราค่าลงทะเบียนในสถานะนี้ได้');

    const bankAccountId = dto.bankAccountId !== undefined ? dto.bankAccountId : event.bankAccountId;
    const incomeCodeId = dto.incomeCodeId !== undefined ? dto.incomeCodeId : event.incomeCodeId;
    const isPaid = this.events.validateFees(dto.feeRates, bankAccountId);
    await this.assertFeeReferences(dto, bankAccountId, incomeCodeId);
    const payload: FeeChangePayload = {
      feeRates: dto.feeRates.map((r) => ({
        nameTh: r.nameTh.trim(),
        amount: moneyIn(r.amount)!.toFixed(2),
        participantTypeId: r.participantTypeId ?? null,
        validFrom: r.validFrom ?? null,
        validUntil: r.validUntil ?? null,
      })),
      bankAccountId: bankAccountId ?? null,
      incomeCodeId: incomeCodeId ?? null,
      isPaid,
    };
    // Finance-review steps apply when the event is paid before or after the change.
    const workflow = await this.selectWorkflow({ ...event, isPaid: isPaid || event.isPaid });
    const steps = this.applicableSteps(workflow.steps, { isPaid: isPaid || event.isPaid });
    if (!steps.length) throw Errors.invalidState('Workflow ไม่มีขั้นตอนที่ใช้กับกิจกรรมนี้');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const last = await tx.approvalRequest.findFirst({ where: { eventId }, orderBy: { round: 'desc' } });
        const request = await tx.approvalRequest.create({
          data: {
            eventId,
            workflowId: workflow.id,
            round: (last?.round ?? 0) + 1,
            trigger: 'FEE_CHANGE',
            status: 'PENDING',
            currentStepOrder: steps[0]!.stepOrder,
            submittedById: user.id,
            payload: payload as unknown as Prisma.InputJsonValue,
            reason: dto.reason.trim(),
          },
        });
        await tx.approvalAction.create({ data: { requestId: request.id, action: 'SUBMIT', actorId: user.id, comment: dto.reason.trim() } });
        await this.audit.log(
          { actorId: user.id, action: 'approval.fee_change.submit', entityType: 'event', entityId: eventId, after: { requestId: request.id, round: request.round, ...payload }, reason: dto.reason, meta },
          tx,
        );
        return { requestId: request.id, round: request.round, currentStep: steps[0]!.nameTh };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw Errors.conflict('APPROVAL_PENDING', 'มีคำขออนุมัติที่รอพิจารณาอยู่แล้ว');
      }
      throw e;
    }
  }

  /** The proposer (or another manager of the event) withdraws a pending fee change. */
  async cancelFeeChange(eventId: string, user: AuthUser, meta: RequestMeta) {
    const event = await this.events.findOrThrow(eventId);
    await this.events.assertCanManage(event, user, 'event:update');
    return this.prisma.$transaction(async (tx) => {
      const req = await tx.approvalRequest.findFirst({ where: { eventId, status: 'PENDING', trigger: 'FEE_CHANGE' } });
      if (!req) throw Errors.invalidState('ไม่มีคำขอแก้ไขอัตราที่รอพิจารณา');
      const res = await tx.approvalRequest.updateMany({ where: { id: req.id, status: 'PENDING' }, data: { status: 'CANCELLED', currentStepOrder: null, completedAt: new Date() } });
      if (res.count !== 1) throw Errors.conflict('ALREADY_DECIDED', 'คำขอนี้ถูกพิจารณาไปแล้ว');
      await tx.approvalAction.create({ data: { requestId: req.id, action: 'CANCEL', actorId: user.id } });
      await this.audit.log({ actorId: user.id, action: 'approval.fee_change.cancel', entityType: 'event', entityId: eventId, after: { requestId: req.id }, meta }, tx);
      return { requestId: req.id, status: 'CANCELLED' };
    });
  }

  /** Pending fee change of an event with the current rates for comparison (null = none pending). */
  async pendingFeeChange(eventId: string, user: AuthUser) {
    const event = await this.events.findOrThrow(eventId);
    await this.assertCanSee(event, user);
    const req = await this.prisma.approvalRequest.findFirst({
      where: { eventId, status: 'PENDING', trigger: 'FEE_CHANGE' },
      include: { submittedBy: { select: { displayName: true } }, workflow: { include: { steps: { orderBy: { stepOrder: 'asc' } } } } },
    });
    if (!req) return null;
    return {
      requestId: req.id,
      round: req.round,
      reason: req.reason,
      submittedAt: req.submittedAt.toISOString(),
      submittedByName: req.submittedBy.displayName,
      currentStep: req.workflow.steps.find((s) => s.stepOrder === req.currentStepOrder)?.nameTh ?? null,
      ...(await this.feeComparison(eventId, req.payload as unknown as FeeChangePayload)),
    };
  }

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
    const feeChange = request.trigger === 'FEE_CHANGE' ? (request.payload as unknown as FeeChangePayload) : null;
    const steps = this.applicableSteps(request.workflow.steps, { isPaid: request.event.isPaid || !!feeChange?.isPaid });
    const step = steps.find((s) => s.stepOrder === request.currentStepOrder);
    if (!step) throw Errors.invalidState('ไม่พบขั้นตอนอนุมัติปัจจุบัน');

    // Separation of duties: the proposer can never approve their own event.
    if (request.submittedById === user.id || request.event.createdById === user.id) {
      throw Errors.forbidden('ผู้เสนอไม่สามารถพิจารณาอนุมัติกิจกรรมของตนเองได้');
    }
    if (!(await this.isApprover(step, request.event, user))) throw Errors.forbidden('ท่านไม่ใช่ผู้อนุมัติในขั้นตอนนี้');

    const next = steps.find((s) => s.stepOrder > step.stepOrder);
    const finalApprove = decision === 'APPROVE' && !next;
    if (feeChange && finalApprove && !ApprovalsService.FEE_CHANGE_STATUSES.includes(request.event.status)) {
      throw Errors.invalidState('สถานะกิจกรรมเปลี่ยนไปแล้ว ใช้อัตราใหม่ไม่ได้ — กรุณาส่งกลับคำขอ');
    }

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
      if (feeChange) {
        // The event keeps its status; only the approved proposal is applied.
        if (finalApprove) {
          await this.events.applyFeeChange(tx, eventId, feeChange, user.id);
          await tx.eventStatusHistory.create({
            data: {
              eventId,
              fromStatus: request.event.status,
              toStatus: request.event.status,
              changedById: user.id,
              reason: ('อนุมัติแก้ไขอัตราค่าลงทะเบียน: ' + (request.reason ?? '')).trim(),
            },
          });
        }
      } else if (finalApprove) {
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
        actorId: user.id, action: `approval.${feeChange ? 'fee_change.' : ''}${decision.toLowerCase()}`, entityType: 'event', entityId: eventId,
        after: { requestId: request.id, trigger: request.trigger, step: step.stepOrder, next: next?.stepOrder ?? null, ...(feeChange && finalApprove ? { applied: feeChange } : {}) }, reason: comment, meta,
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
      const feeChange = r.trigger === 'FEE_CHANGE' ? (r.payload as unknown as FeeChangePayload) : null;
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
          feeChange: feeChange ? { reason: r.reason, ...(await this.feeComparison(r.event.id, feeChange)) } : null,
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

  private async assertCanSee(event: Event, user: AuthUser) {
    await this.events.assertCanManage(event, user, 'event:view').catch((e) => {
      if (!this.access.has(user, 'approval:approve')) throw e;
    });
  }

  /** Participant types, receiving account and income code of a proposal must exist and be active. */
  private async assertFeeReferences(dto: FeeChangeDto, bankAccountId: string | null | undefined, incomeCodeId: string | null | undefined) {
    const typeIds = [...new Set(dto.feeRates.map((r) => r.participantTypeId).filter((x): x is string => !!x))];
    const [types, bank, income] = await Promise.all([
      typeIds.length ? this.prisma.participantType.count({ where: { id: { in: typeIds } } }) : 0,
      bankAccountId ? this.prisma.bankAccount.findFirst({ where: { id: bankAccountId, isActive: true } }) : null,
      incomeCodeId ? this.prisma.incomeCode.findFirst({ where: { id: incomeCodeId, isActive: true } }) : null,
    ]);
    if (types !== typeIds.length) throw Errors.validation('ไม่พบประเภทผู้เข้าร่วมที่ระบุในอัตรา');
    if (bankAccountId && !bank) throw Errors.validation('บัญชีรับเงินไม่ถูกต้องหรือปิดใช้งานแล้ว');
    if (incomeCodeId && !income) throw Errors.validation('รหัสรายได้ไม่ถูกต้องหรือปิดใช้งานแล้ว');
  }

  /** Current active rates vs. the proposal, with names resolved for display. */
  private async feeComparison(eventId: string, p: FeeChangePayload) {
    const [current, event, types, bank, income] = await Promise.all([
      this.prisma.eventFeeRate.findMany({ where: { eventId, isActive: true }, orderBy: { sortOrder: 'asc' }, include: { participantType: { select: { nameTh: true } } } }),
      this.prisma.event.findUniqueOrThrow({ where: { id: eventId }, include: { bankAccount: true, incomeCode: true } }),
      this.prisma.participantType.findMany({ select: { id: true, nameTh: true } }),
      p.bankAccountId ? this.prisma.bankAccount.findUnique({ where: { id: p.bankAccountId } }) : null,
      p.incomeCodeId ? this.prisma.incomeCode.findUnique({ where: { id: p.incomeCodeId } }) : null,
    ]);
    const typeName = new Map(types.map((t) => [t.id, t.nameTh]));
    const acct = (a: { bankName: string; accountNo: string } | null) => (a ? a.bankName + ' ' + a.accountNo : null);
    return {
      current: {
        feeRates: current.map((r) => ({
          nameTh: r.nameTh,
          amount: r.amount.toFixed(2),
          participantTypeName: r.participantType?.nameTh ?? null,
          validFrom: r.validFrom?.toISOString() ?? null,
          validUntil: r.validUntil?.toISOString() ?? null,
        })),
        bankAccount: acct(event.bankAccount),
        incomeCode: event.incomeCode?.code ?? null,
      },
      proposed: {
        feeRates: p.feeRates.map((r) => ({
          nameTh: r.nameTh,
          amount: r.amount,
          participantTypeName: r.participantTypeId ? (typeName.get(r.participantTypeId) ?? null) : null,
          validFrom: r.validFrom ?? null,
          validUntil: r.validUntil ?? null,
        })),
        bankAccount: acct(bank),
        incomeCode: income?.code ?? null,
      },
    };
  }

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
