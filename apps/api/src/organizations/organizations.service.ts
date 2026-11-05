import { Injectable } from '@nestjs/common';
import type { OrganizationDto } from '@sru/shared-types';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import type { RequestMeta } from '../common/decorators';
import { Errors } from '../common/errors';
import type { AuthUser } from '../auth/auth.types';
import { Organization, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AddMemberDto,
  CreateOrganizationDto,
  OrganizationQueryDto,
  UpdateOrganizationDto,
} from './organizations.dto';

const toDto = (o: Organization): OrganizationDto => ({
  id: o.id,
  code: o.code,
  nameTh: o.nameTh,
  nameEn: o.nameEn,
  type: o.type,
  parentId: o.parentId,
  isActive: o.isActive,
  isFinanceDivision: o.isFinanceDivision,
});

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async list(q: OrganizationQueryDto) {
    const rows = await this.prisma.organization.findMany({
      where: {
        deletedAt: null,
        ...(q.includeInactive ? {} : { isActive: true }),
        ...(q.type ? { type: q.type } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { nameTh: 'asc' }],
    });
    const dtos = rows.map(toDto);
    if (!q.tree) return dtos;

    const byId = new Map(dtos.map((d) => [d.id, { ...d, children: [] as OrganizationDto[] }]));
    const roots: OrganizationDto[] = [];
    for (const node of byId.values()) {
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (parent) parent.children!.push(node);
      else roots.push(node);
    }
    return roots;
  }

  async get(id: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id, deletedAt: null },
      include: {
        parent: true,
        head: { select: { id: true, displayName: true, email: true } },
        members: {
          include: { user: { select: { id: true, displayName: true, email: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!org) throw Errors.notFound('หน่วยงาน');
    return {
      ...toDto(org),
      shortName: org.shortName,
      sortOrder: org.sortOrder,
      parent: org.parent ? toDto(org.parent) : null,
      head: org.head,
      members: org.members.map((m) => ({
        id: m.id,
        memberRole: m.memberRole,
        position: m.position,
        isPrimary: m.isPrimary,
        user: m.user,
      })),
    };
  }

  async create(dto: CreateOrganizationDto, user: AuthUser, meta: RequestMeta) {
    // Creating a child requires rights on the parent; creating a root requires ALL scope.
    if (dto.parentId) await this.access.assertOrg(user, 'organization:create', dto.parentId);
    else if ((await this.access.orgScope(user, 'organization:create')) !== 'ALL') throw Errors.forbidden();

    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { ...dto, code: dto.code.toUpperCase(), createdById: user.id },
      });
      await this.audit.log(
        { actorId: user.id, action: 'organization.create', entityType: 'organization', entityId: org.id, after: org, meta },
        tx,
      );
      return toDto(org);
    });
  }

  async update(id: string, dto: UpdateOrganizationDto, user: AuthUser, meta: RequestMeta) {
    await this.access.assertOrg(user, 'organization:update', id);
    const before = await this.prisma.organization.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw Errors.notFound('หน่วยงาน');

    if (dto.parentId !== undefined && dto.parentId !== before.parentId) {
      if (dto.parentId === id) throw Errors.validation('หน่วยงานไม่สามารถเป็นหน่วยงานแม่ของตนเองได้');
      if (dto.parentId) {
        await this.access.assertOrg(user, 'organization:update', dto.parentId);
        const descendants = await this.access.descendants([id]);
        if (descendants.includes(dto.parentId)) {
          throw Errors.validation('ไม่สามารถย้ายหน่วยงานไปอยู่ใต้หน่วยงานย่อยของตนเองได้');
        }
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const after = await tx.organization.update({
        where: { id },
        data: { ...dto, updatedById: user.id } as Prisma.OrganizationUncheckedUpdateInput,
      });
      await this.audit.log(
        { actorId: user.id, action: 'organization.update', entityType: 'organization', entityId: id, before, after, meta },
        tx,
      );
      return toDto(after);
    });
  }

  /** "ยกเลิกหน่วยงาน" — deactivate, never hard-delete (events & finance reference it). */
  async deactivate(id: string, user: AuthUser, meta: RequestMeta) {
    await this.access.assertOrg(user, 'organization:delete', id);
    const activeChildren = await this.prisma.organization.count({
      where: { parentId: id, isActive: true, deletedAt: null },
    });
    if (activeChildren) throw Errors.invalidState('ต้องยกเลิกหน่วยงานย่อยก่อน');
    return this.update(id, { isActive: false }, user, meta);
  }

  async addMember(orgId: string, dto: AddMemberDto, user: AuthUser, meta: RequestMeta) {
    await this.access.assertOrg(user, 'organization:update', orgId);
    const m = await this.prisma.userOrganization.create({ data: { ...dto, organizationId: orgId } });
    await this.audit.log({ actorId: user.id, action: 'organization.member.add', entityType: 'organization', entityId: orgId, after: m, meta });
    return m;
  }

  async removeMember(orgId: string, memberId: string, user: AuthUser, meta: RequestMeta) {
    await this.access.assertOrg(user, 'organization:update', orgId);
    const m = await this.prisma.userOrganization.findFirst({ where: { id: memberId, organizationId: orgId } });
    if (!m) throw Errors.notFound('สมาชิก');
    await this.prisma.userOrganization.delete({ where: { id: memberId } });
    await this.audit.log({ actorId: user.id, action: 'organization.member.remove', entityType: 'organization', entityId: orgId, before: m, meta });
    return { removed: true };
  }
}
