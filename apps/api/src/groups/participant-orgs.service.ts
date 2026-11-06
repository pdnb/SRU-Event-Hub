import { Injectable } from '@nestjs/common';
import type { ParticipantOrganizationDto } from '@sru/shared-types';
import { isValidThaiTaxId, normalizeTaxId } from '@sru/shared-utils';
import type { AuthUser } from '../auth/auth.types';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import type { RequestMeta } from '../common/decorators';
import { Errors } from '../common/errors';
import { Paginated } from '../common/pagination';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AddCoordinatorDto, ParticipantOrgDto, ParticipantOrgQueryDto } from './groups.dto';

const WITH_COORDINATORS = {
  coordinators: { include: { user: { select: { id: true, displayName: true, email: true } } }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.ParticipantOrganizationInclude;
type OrgRow = Prisma.ParticipantOrganizationGetPayload<{ include: typeof WITH_COORDINATORS }>;

/**
 * External organizations that send participants (schools, agencies, companies). Any signed-in user
 * may create one and becomes its coordinator (ORG_COORDINATOR role, OWN scope). Organizers with
 * participant_org:approve can mark an organization as verified.
 */
@Injectable()
export class ParticipantOrgsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async mine(user: AuthUser): Promise<ParticipantOrganizationDto[]> {
    const rows = await this.prisma.participantOrganization.findMany({
      where: { deletedAt: null, coordinators: { some: { userId: user.id } } },
      include: WITH_COORDINATORS,
      orderBy: { nameTh: 'asc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async create(dto: ParticipantOrgDto, user: AuthUser, meta: RequestMeta) {
    const data = this.columns(dto);
    const org = await this.prisma.$transaction(async (tx) => {
      const o = await tx.participantOrganization.create({
        data: {
          ...data,
          createdById: user.id,
          coordinators: { create: { userId: user.id, position: dto.position || null, phone: data.phone, isPrimary: true, createdById: user.id } },
        },
        include: WITH_COORDINATORS,
      });
      await this.ensureCoordinatorRole(tx, user.id);
      await this.audit.log({ actorId: user.id, action: 'participant_org.create', entityType: 'participant_organization', entityId: o.id, after: data, meta }, tx);
      return o;
    });
    return this.toDto(org);
  }

  async update(id: string, dto: ParticipantOrgDto, user: AuthUser, meta: RequestMeta) {
    const before = await this.assertCoordinator(id, user);
    const data = this.columns(dto);
    const o = await this.prisma.participantOrganization.update({
      where: { id },
      // Identity-relevant changes drop the verification mark (an organizer checks again).
      data: {
        ...data,
        updatedById: user.id,
        ...(before.nameTh !== data.nameTh || before.taxId !== data.taxId ? { verifiedAt: null, verifiedById: null } : {}),
      },
      include: WITH_COORDINATORS,
    });
    await this.audit.log({ actorId: user.id, action: 'participant_org.update', entityType: 'participant_organization', entityId: id, before: { nameTh: before.nameTh, taxId: before.taxId, address: before.address }, after: data, meta });
    return this.toDto(o);
  }

  async addCoordinator(id: string, dto: AddCoordinatorDto, user: AuthUser, meta: RequestMeta) {
    await this.assertCoordinator(id, user);
    const target = await this.prisma.user.findFirst({ where: { email: dto.email.trim().toLowerCase(), deletedAt: null, status: 'ACTIVE' } });
    if (!target) throw Errors.validation('ไม่พบบัญชีผู้ใช้ของอีเมลนี้ กรุณาให้ผู้ประสานงานสมัครสมาชิกก่อน');
    await this.prisma.$transaction(async (tx) => {
      await tx.organizationCoordinator.upsert({
        where: { participantOrganizationId_userId: { participantOrganizationId: id, userId: target.id } },
        create: { participantOrganizationId: id, userId: target.id, position: dto.position || null, createdById: user.id },
        update: { position: dto.position || null },
      });
      await this.ensureCoordinatorRole(tx, target.id);
      await this.audit.log({ actorId: user.id, action: 'participant_org.coordinator_add', entityType: 'participant_organization', entityId: id, after: { userId: target.id }, meta }, tx);
    });
    return this.get(id);
  }

  async removeCoordinator(id: string, userId: string, user: AuthUser, meta: RequestMeta) {
    await this.assertCoordinator(id, user);
    const count = await this.prisma.organizationCoordinator.count({ where: { participantOrganizationId: id } });
    if (count <= 1) throw Errors.invalidState('องค์กรต้องมีผู้ประสานงานอย่างน้อย 1 คน');
    const open = await this.prisma.registrationGroup.count({
      where: { participantOrganizationId: id, coordinatorUserId: userId, status: { in: ['DRAFT', 'PENDING_PAYMENT', 'CONFIRMED'] } },
    });
    if (open) throw Errors.invalidState('ผู้ประสานงานนี้ยังดูแลกลุ่มที่ใช้งานอยู่');
    await this.prisma.organizationCoordinator.deleteMany({ where: { participantOrganizationId: id, userId } });
    await this.audit.log({ actorId: user.id, action: 'participant_org.coordinator_remove', entityType: 'participant_organization', entityId: id, before: { userId }, meta });
    return this.get(id);
  }

  // ───────────── Organizer side ─────────────

  async list(q: ParticipantOrgQueryDto) {
    const where: Prisma.ParticipantOrganizationWhereInput = {
      deletedAt: null,
      ...(q.verified === true ? { verifiedAt: { not: null } } : q.verified === false ? { verifiedAt: null } : {}),
      ...(q.search ? { OR: [{ nameTh: { contains: q.search, mode: 'insensitive' } }, { taxId: q.search.replace(/\D/g, '') || undefined }] } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.participantOrganization.findMany({ where, include: WITH_COORDINATORS, orderBy: { createdAt: q.order }, skip: q.skip, take: q.perPage }),
      this.prisma.participantOrganization.count({ where }),
    ]);
    return Paginated.of(rows.map((r) => this.toDto(r)), total, q);
  }

  async verify(id: string, verified: boolean, user: AuthUser, meta: RequestMeta) {
    const o = await this.prisma.participantOrganization.findFirst({ where: { id, deletedAt: null } });
    if (!o) throw Errors.notFound('องค์กร');
    const isCoordinator = await this.prisma.organizationCoordinator.count({ where: { participantOrganizationId: id, userId: user.id } });
    if (isCoordinator) throw Errors.forbidden('ผู้ประสานงานขององค์กรตรวจสอบองค์กรของตนเองไม่ได้ (การแบ่งแยกหน้าที่)');
    await this.prisma.participantOrganization.update({
      where: { id },
      data: verified ? { verifiedAt: new Date(), verifiedById: user.id } : { verifiedAt: null, verifiedById: null },
    });
    await this.audit.log({ actorId: user.id, action: verified ? 'participant_org.verify' : 'participant_org.unverify', entityType: 'participant_organization', entityId: id, meta });
    return this.get(id);
  }

  async get(id: string) {
    const o = await this.prisma.participantOrganization.findFirst({ where: { id, deletedAt: null }, include: WITH_COORDINATORS });
    if (!o) throw Errors.notFound('องค์กร');
    return this.toDto(o);
  }

  // ───────────── helpers ─────────────

  async assertCoordinator(id: string, user: AuthUser) {
    const o = await this.prisma.participantOrganization.findFirst({ where: { id, deletedAt: null } });
    if (!o) throw Errors.notFound('องค์กร');
    const c = await this.prisma.organizationCoordinator.findUnique({ where: { participantOrganizationId_userId: { participantOrganizationId: id, userId: user.id } } });
    if (!c) throw Errors.forbidden('เฉพาะผู้ประสานงานขององค์กรนี้');
    return o;
  }

  /** Cosmetic role grant so menus show the coordinator pages (permissions come from coordinator rows). */
  private async ensureCoordinatorRole(tx: Prisma.TransactionClient, userId: string) {
    const role = await tx.role.findUnique({ where: { code: 'ORG_COORDINATOR' } });
    if (!role) return;
    const has = await tx.userRole.findFirst({ where: { userId, roleId: role.id, organizationId: null } });
    if (!has) await tx.userRole.create({ data: { userId, roleId: role.id, organizationId: null, scope: 'OWN' } });
  }

  private columns(dto: ParticipantOrgDto) {
    let taxId: string | null = null;
    if (dto.taxId?.trim()) {
      taxId = normalizeTaxId(dto.taxId);
      if (!isValidThaiTaxId(taxId)) throw Errors.validation('เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง (13 หลัก)');
    }
    const branch = dto.branch?.trim() || null;
    if (branch && !/^\d{5}$/.test(branch)) throw Errors.validation('สาขาต้องเป็นเลข 5 หลัก (00000 = สำนักงานใหญ่)');
    return {
      nameTh: dto.nameTh.trim(),
      orgType: dto.orgType,
      taxId,
      branch: taxId ? (branch ?? '00000') : null,
      address: dto.address?.trim() || null,
      province: dto.province?.trim() || null,
      phone: dto.phone || null,
      email: dto.email?.trim().toLowerCase() || null,
    };
  }

  toDto(o: OrgRow): ParticipantOrganizationDto {
    return {
      id: o.id,
      nameTh: o.nameTh,
      orgType: o.orgType,
      taxId: o.taxId,
      branch: o.branch,
      address: o.address,
      province: o.province,
      phone: o.phone,
      email: o.email,
      verified: !!o.verifiedAt,
      coordinators: o.coordinators.map((c) => ({
        userId: c.userId,
        displayName: c.user.displayName,
        email: c.user.email,
        position: c.position,
        isPrimary: c.isPrimary,
      })),
      createdAt: o.createdAt.toISOString(),
    };
  }
}
