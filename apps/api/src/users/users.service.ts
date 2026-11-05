import { Injectable } from '@nestjs/common';
import { ROLE_CODES } from '@sru/shared-types';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import type { RequestMeta } from '../common/decorators';
import { Errors } from '../common/errors';
import { Paginated } from '../common/pagination';
import { hashPassword } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, GrantRoleDto, UpdateUserStatusDto, UserQueryDto } from './users.dto';

const PRIVILEGED = new Set<string>([ROLE_CODES.SUPER_ADMIN, ROLE_CODES.SYSTEM_ADMIN]);

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async list(q: UserQueryDto, actor: AuthUser) {
    const scope = await this.access.orgScope(actor, 'user:view');
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.userType ? { userType: q.userType } : {}),
      ...(q.search
        ? {
            OR: [
              { displayName: { contains: q.search, mode: 'insensitive' } },
              { email: { contains: q.search, mode: 'insensitive' } },
              { profile: { staffCode: q.search } },
              { profile: { studentCode: q.search } },
            ],
          }
        : {}),
      ...(q.organizationId ? { organizations: { some: { organizationId: q.organizationId } } } : {}),
      ...(scope === 'ALL' ? {} : { organizations: { some: { organizationId: { in: scope } } } }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip: q.skip,
        take: q.perPage,
        orderBy: { createdAt: q.order },
        include: {
          profile: true,
          roles: { include: { role: true, organization: { select: { id: true, nameTh: true } } } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return Paginated.of(rows.map((u) => this.toDto(u)), total, q);
  }

  async get(id: string) {
    const u = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: {
        profile: true,
        roles: { include: { role: true, organization: { select: { id: true, nameTh: true } } } },
        organizations: { include: { organization: { select: { id: true, nameTh: true } } } },
      },
    });
    if (!u) throw Errors.notFound('ผู้ใช้');
    return {
      ...this.toDto(u),
      organizations: u.organizations.map((o) => ({
        id: o.id,
        memberRole: o.memberRole,
        position: o.position,
        organization: o.organization,
      })),
    };
  }

  async create(dto: CreateUserDto, actor: AuthUser, meta: RequestMeta) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email,
          username: dto.username?.toLowerCase(),
          displayName: dto.displayName,
          userType: dto.userType,
          passwordHash: dto.password ? await hashPassword(dto.password) : null,
          createdById: actor.id,
          profile: { create: { staffCode: dto.staffCode, studentCode: dto.studentCode } },
        },
      });
      await this.audit.log(
        { actorId: actor.id, action: 'user.create', entityType: 'user', entityId: u.id, after: { email, userType: u.userType }, meta },
        tx,
      );
      return u;
    });
    return this.get(user.id);
  }

  async setStatus(id: string, dto: UpdateUserStatusDto, actor: AuthUser, meta: RequestMeta) {
    if (id === actor.id) throw Errors.forbidden('ไม่สามารถเปลี่ยนสถานะบัญชีของตนเองได้');
    const before = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw Errors.notFound('ผู้ใช้');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { status: dto.status, updatedById: actor.id } });
      if (dto.status === 'SUSPENDED') {
        // Kill all sessions immediately.
        await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await this.audit.log(
        { actorId: actor.id, action: 'user.status', entityType: 'user', entityId: id, before: { status: before.status }, after: { status: dto.status }, reason: dto.reason, meta },
        tx,
      );
    });
    return this.get(id);
  }

  async grantRole(id: string, dto: GrantRoleDto, actor: AuthUser, meta: RequestMeta) {
    if (id === actor.id) throw Errors.forbidden('ไม่สามารถกำหนดสิทธิ์ให้ตนเองได้');
    const role = await this.prisma.role.findUnique({ where: { code: dto.roleCode } });
    if (!role) throw Errors.notFound('บทบาท');
    const actorIsSuper = actor.grants.some((g) => g.code === ROLE_CODES.SUPER_ADMIN);
    if (PRIVILEGED.has(role.code) && !actorIsSuper) throw Errors.forbidden('เฉพาะ Super Admin เท่านั้น');
    if (dto.scope === 'ALL' && (await this.access.orgScope(actor, 'role:update')) !== 'ALL') throw Errors.forbidden();
    if (dto.scope !== 'ALL' && dto.scope !== 'OWN' && !dto.organizationId) {
      throw Errors.validation('ต้องระบุหน่วยงานสำหรับขอบเขตข้อมูลระดับหน่วยงาน');
    }
    if (dto.organizationId) await this.access.assertOrg(actor, 'role:update', dto.organizationId);

    const grant = await this.prisma.userRole.create({
      data: { userId: id, roleId: role.id, organizationId: dto.organizationId ?? null, scope: dto.scope, grantedById: actor.id },
    });
    await this.audit.log({ actorId: actor.id, action: 'user.role.grant', entityType: 'user', entityId: id, after: { role: role.code, organizationId: grant.organizationId, scope: grant.scope }, meta });
    return this.get(id);
  }

  async revokeRole(id: string, grantId: string, actor: AuthUser, meta: RequestMeta) {
    if (id === actor.id) throw Errors.forbidden('ไม่สามารถเพิกถอนสิทธิ์ของตนเองได้');
    const grant = await this.prisma.userRole.findFirst({ where: { id: grantId, userId: id }, include: { role: true } });
    if (!grant) throw Errors.notFound('สิทธิ์');
    if (PRIVILEGED.has(grant.role.code) && !actor.grants.some((g) => g.code === ROLE_CODES.SUPER_ADMIN)) {
      throw Errors.forbidden('เฉพาะ Super Admin เท่านั้น');
    }
    if (grant.organizationId) await this.access.assertOrg(actor, 'role:update', grant.organizationId);
    await this.prisma.userRole.delete({ where: { id: grantId } });
    await this.audit.log({ actorId: actor.id, action: 'user.role.revoke', entityType: 'user', entityId: id, before: { role: grant.role.code, organizationId: grant.organizationId, scope: grant.scope }, meta });
    return this.get(id);
  }

  listRoles() {
    return this.prisma.role.findMany({
      orderBy: { code: 'asc' },
      include: { permissions: { include: { permission: true } } },
    }).then((roles) =>
      roles.map((r) => ({ id: r.id, code: r.code, nameTh: r.nameTh, description: r.description, permissions: r.permissions.map((p) => p.permission.code).sort() })),
    );
  }

  private toDto(u: Prisma.UserGetPayload<{ include: { profile: true; roles: { include: { role: true; organization: { select: { id: true; nameTh: true } } } } } }>) {
    return {
      id: u.id,
      email: u.email,
      username: u.username,
      displayName: u.displayName,
      userType: u.userType,
      status: u.status,
      localLogin: Boolean(u.passwordHash),
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      staffCode: u.profile?.staffCode ?? null,
      studentCode: u.profile?.studentCode ?? null,
      roles: u.roles.map((r) => ({
        id: r.id,
        code: r.role.code,
        nameTh: r.role.nameTh,
        scope: r.scope,
        organization: r.organization,
      })),
    };
  }
}
