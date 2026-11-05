import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { AuditService } from '../common/audit.service';
import { CurrentUser, Public, ReqMeta, RequestMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

class LookupDto {
  @Matches(/^[A-Z0-9_]{2,50}$/) code!: string;
  @IsString() @MinLength(2) @MaxLength(200) nameTh!: string;
  @IsOptional() @IsString() @MaxLength(200) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(20) color?: string;
  @IsOptional() @IsInt() sortOrder?: number;
}

class LookupUpdateDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) nameTh?: string;
  @IsOptional() @IsString() @MaxLength(200) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(20) color?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/**
 * Configurable lookups: event types, categories and participant types are
 * data, not code (spec §4.3). Deactivate instead of delete.
 */
@ApiTags('lookups')
@Controller()
export class CategoriesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Get('lookups')
  async lookups() {
    const active = { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' as const }, { nameTh: 'asc' as const }] };
    const [eventTypes, categories, participantTypes] = await Promise.all([
      this.prisma.eventType.findMany(active),
      this.prisma.eventCategory.findMany(active),
      this.prisma.participantType.findMany(active),
    ]);
    return { eventTypes, categories, participantTypes };
  }

  @RequirePermissions('event_category:create')
  @Post('event-categories')
  async createCategory(@Body() dto: LookupDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    const row = await this.prisma.eventCategory.create({ data: dto });
    await this.audit.log({ actorId: u.id, action: 'event_category.create', entityType: 'event_category', entityId: row.id, after: row, meta: m });
    return row;
  }

  @RequirePermissions('event_category:update')
  @Patch('event-categories/:id')
  async updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LookupUpdateDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    const row = await this.prisma.eventCategory.update({ where: { id }, data: dto });
    await this.audit.log({ actorId: u.id, action: 'event_category.update', entityType: 'event_category', entityId: id, after: row, meta: m });
    return row;
  }

  @RequirePermissions('event_category:create')
  @Post('event-types')
  async createType(@Body() dto: LookupDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    const { color: _c, ...data } = dto;
    const row = await this.prisma.eventType.create({ data });
    await this.audit.log({ actorId: u.id, action: 'event_type.create', entityType: 'event_type', entityId: row.id, after: row, meta: m });
    return row;
  }

  @RequirePermissions('event_category:update')
  @Patch('event-types/:id')
  async updateType(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LookupUpdateDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    const { color: _c, ...data } = dto;
    const row = await this.prisma.eventType.update({ where: { id }, data });
    await this.audit.log({ actorId: u.id, action: 'event_type.update', entityType: 'event_type', entityId: id, after: row, meta: m });
    return row;
  }
}
