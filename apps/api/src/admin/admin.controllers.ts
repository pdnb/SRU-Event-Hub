import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Allow, IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { AuthUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/decorators';
import { Errors } from '../common/errors';
import { PageQueryDto, Paginated } from '../common/pagination';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export class AuditQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ example: 'payment.verify' }) @IsOptional() @IsString() @MaxLength(100) action?: string;
  @IsOptional() @IsString() @MaxLength(60) entityType?: string;
  @IsOptional() @IsString() @MaxLength(64) entityId?: string;
  @IsOptional() @IsUUID() actorId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

/**
 * Audit trail viewer (audit_log:view). Read-only by design – the table is append-only in the DB.
 * Searching by action prefix (e.g. "payment.") or by entity is what investigations need most.
 */
@ApiTags('audit-logs')
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly prisma: PrismaService) {}

  @RequirePermissions('audit_log:view')
  @Get()
  async list(@Query() q: AuditQueryDto) {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.action ? { action: { startsWith: q.action.trim() } } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.search ? { OR: [{ entityId: q.search.trim() }, { reason: { contains: q.search.trim(), mode: 'insensitive' } }, { requestId: q.search.trim() }] } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: q.order }, skip: q.skip, take: q.perPage }),
      this.prisma.auditLog.count({ where }),
    ]);
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
    const actors = new Map(
      (await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true } })).map((u) => [u.id, u.displayName]),
    );
    return Paginated.of(
      rows.map((r) => ({ ...r, actorName: r.actorId ? (actors.get(r.actorId) ?? null) : 'ระบบ', createdAt: r.createdAt.toISOString() })),
      total,
      q,
    );
  }

  /** Distinct action codes for the filter dropdown. */
  @RequirePermissions('audit_log:view')
  @Get('actions')
  async actions() {
    const rows = await this.prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } });
    return rows.map((r) => r.action);
  }
}

export class UpdateSettingDto {
  /** Any JSON value; must keep the type of the current value. */
  @Allow() value!: unknown;
}

/**
 * System settings (system_setting:view / update). Only existing keys can be changed and the JSON
 * type of the value must stay the same, so a typo cannot silently create or break a setting.
 */
@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermissions('system_setting:view')
  @Get()
  list() {
    return this.prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
  }

  @RequirePermissions('system_setting:update')
  @Patch(':key')
  async update(@Param('key') key: string, @Body() dto: UpdateSettingDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    if (!/^[\w.]{1,100}$/.test(key)) throw Errors.validation('คีย์ไม่ถูกต้อง');
    const current = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (!current) throw Errors.notFound('การตั้งค่า');
    const kind = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
    if (kind(dto.value) !== kind(current.value)) {
      throw Errors.validation(`ชนิดข้อมูลต้องเป็น ${kind(current.value)} เหมือนค่าเดิม`);
    }
    if (JSON.stringify(dto.value).length > 10_000) throw Errors.validation('ค่าที่ตั้งยาวเกินไป');
    const row = await this.prisma.systemSetting.update({ where: { key }, data: { value: dto.value as Prisma.InputJsonValue, updatedById: u.id } });
    await this.audit.log({ actorId: u.id, action: 'setting.update', entityType: 'system_setting', entityId: key, before: { value: current.value }, after: { value: row.value }, meta: m });
    return row;
  }
}

