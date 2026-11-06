import { HttpStatus, Injectable } from '@nestjs/common';
import type { GroupInvitationViewDto } from '@sru/shared-types';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import type { RequestMeta } from '../common/decorators';
import { AppError, Errors } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { AcceptInvitationDto, CreateInvitationDto } from './groups.dto';
import { GroupsService, MEMBER_STATUSES } from './groups.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Invitation links (ลิงก์เชิญ). The token is random, shown once, stored as SHA-256.
 *  * member link  (registration_id set): that member reviews / completes their own details and
 *    gives their own PDPA consent. Works before and after submission (as a substitution-free edit).
 *  * open link    (registration_id null): each use adds a new DRAFT member – only while DRAFT.
 * Lookups return only the invited member's own data, never the rest of the group.
 */
@Injectable()
export class GroupInvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly groups: GroupsService,
  ) {}

  async create(groupId: string, dto: CreateInvitationDto, user: AuthUser, meta: RequestMeta) {
    const g = await this.groups.loadForCoordinator(groupId, user);
    const s = await this.prisma.eventGroupSetting.findUnique({ where: { eventId: g.eventId } });
    if (!s?.isEnabled || !s.allowInviteLinks) throw Errors.conflict('INVITE_DISABLED', 'กิจกรรมนี้ไม่อนุญาตลิงก์เชิญสมาชิก');
    if (!['DRAFT', 'PENDING_PAYMENT', 'CONFIRMED'].includes(g.status)) throw Errors.invalidState('กลุ่มนี้ถูกยกเลิกหรือหมดเวลาแล้ว');
    if (dto.registrationId) {
      const m = await this.prisma.registration.findFirst({ where: { id: dto.registrationId, groupId, status: { in: MEMBER_STATUSES } } });
      if (!m) throw Errors.notFound('สมาชิกในกลุ่ม');
    } else if (g.status !== 'DRAFT') {
      throw Errors.invalidState('ลิงก์เชิญแบบเปิด (เพิ่มสมาชิกใหม่) ใช้ได้เฉพาะก่อนส่งกลุ่ม');
    }
    const event = await this.prisma.event.findUniqueOrThrow({ where: { id: g.eventId }, select: { startAt: true } });
    const days = dto.expiresInDays ?? 7;
    const expiresAt = new Date(Math.min(Date.now() + days * 86400_000, event.startAt.getTime()));
    const token = randomBytes(24).toString('base64url');
    const inv = await this.prisma.groupMemberInvitation.create({
      data: {
        groupId,
        registrationId: dto.registrationId ?? null,
        tokenHash: sha256(token),
        maxUses: dto.registrationId ? 1 : (dto.maxUses ?? s.maxMembers),
        expiresAt,
        createdById: user.id,
      },
    });
    await this.audit.log({ actorId: user.id, action: 'group.invitation_create', entityType: 'registration_group', entityId: groupId, after: { invitationId: inv.id, registrationId: inv.registrationId, maxUses: inv.maxUses }, meta });
    // The token is returned exactly once.
    return { id: inv.id, token, expiresAt: inv.expiresAt.toISOString(), maxUses: inv.maxUses };
  }

  async revoke(groupId: string, invitationId: string, user: AuthUser, meta: RequestMeta) {
    await this.groups.loadForCoordinator(groupId, user);
    const res = await this.prisma.groupMemberInvitation.updateMany({ where: { id: invitationId, groupId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!res.count) throw Errors.notFound('ลิงก์เชิญ');
    await this.audit.log({ actorId: user.id, action: 'group.invitation_revoke', entityType: 'registration_group', entityId: groupId, after: { invitationId }, meta });
    return { revoked: true };
  }

  async view(token: string): Promise<GroupInvitationViewDto> {
    const inv = await this.findUsable(token);
    const g = await this.prisma.registrationGroup.findUniqueOrThrow({
      where: { id: inv.groupId },
      include: {
        participantOrganization: { select: { nameTh: true } },
        coordinator: { select: { displayName: true } },
        event: { select: { id: true, code: true, titleTh: true, startAt: true, endAt: true, venueText: true } },
      },
    });
    const detail = await this.groups.buildDetail(g.id);
    const m = inv.registrationId ? detail.members.find((x) => x.id === inv.registrationId) : null;
    return {
      groupNo: g.groupNo,
      groupName: g.name,
      organizationName: g.participantOrganization.nameTh,
      coordinatorName: g.coordinator.displayName,
      event: { ...g.event, startAt: g.event.startAt.toISOString(), endAt: g.event.endAt.toISOString() },
      member: m
        ? {
            id: m.id,
            prefix: m.prefix,
            firstName: m.firstName,
            lastName: m.lastName,
            fullName: m.fullName,
            email: m.email,
            phone: m.phone,
            participantTypeCode: m.participantTypeCode,
            participantTypeName: m.participantTypeName,
            studentOrStaffCode: m.studentOrStaffCode,
            affiliation: m.affiliation,
            program: m.program,
            answers: m.answers,
          }
        : null,
      fields: detail.fields,
      participantTypes: detail.participantTypes,
      expiresAt: inv.expiresAt.toISOString(),
    };
  }

  /** Member submits their details through the link (records their own PDPA consent). */
  async accept(dto: AcceptInvitationDto, user: AuthUser | undefined, meta: RequestMeta) {
    const inv = await this.findUsable(dto.token);
    const actorId = user?.id ?? null;
    // Claim one use atomically (concurrent submissions of an open link cannot exceed max_uses).
    const claimed = await this.prisma.groupMemberInvitation.updateMany({
      where: { id: inv.id, revokedAt: null, usedCount: { lt: inv.maxUses }, expiresAt: { gt: new Date() } },
      data: { usedCount: { increment: 1 }, lastUsedAt: new Date() },
    });
    if (!claimed.count) throw this.unusable();
    try {
      if (inv.registrationId) {
        await this.groups.updateMember(inv.groupId, inv.registrationId, { ...dto, reason: 'สมาชิกยืนยัน/แก้ไขข้อมูลผ่านลิงก์เชิญ' }, actorId, meta, { selfConsent: true });
      } else {
        const reg = await this.groups.addMember(inv.groupId, dto, actorId, meta, { selfConsent: true });
        if (user) await this.prisma.registration.update({ where: { id: reg.id }, data: { userId: user.id } });
      }
    } catch (e) {
      // Give the use back so a validation error does not burn the link.
      await this.prisma.groupMemberInvitation.update({ where: { id: inv.id }, data: { usedCount: { decrement: 1 } } });
      throw e;
    }
    await this.prisma.$transaction((tx) => this.groups.log(tx, inv.groupId, 'invitation.accept', actorId, { registrationId: inv.registrationId ?? undefined, after: { invitationId: inv.id, email: dto.email } }));
    return { accepted: true };
  }

  private async findUsable(token: string) {
    const inv = await this.prisma.groupMemberInvitation.findUnique({ where: { tokenHash: sha256(token) }, include: { group: { select: { status: true } } } });
    if (!inv || inv.revokedAt || inv.expiresAt <= new Date() || inv.usedCount >= inv.maxUses) throw this.unusable();
    if (!['DRAFT', 'PENDING_PAYMENT', 'CONFIRMED'].includes(inv.group.status)) throw this.unusable();
    if (!inv.registrationId && inv.group.status !== 'DRAFT') throw this.unusable();
    return inv;
  }

  /** One message for missing / expired / used / revoked so tokens cannot be probed. */
  private unusable() {
    return new AppError('INVITATION_INVALID', 'ลิงก์เชิญไม่ถูกต้อง หมดอายุ หรือถูกใช้ไปแล้ว', HttpStatus.NOT_FOUND);
  }
}
