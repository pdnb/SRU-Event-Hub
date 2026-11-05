import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public, ReqMeta, RequestMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../auth/auth.types';
import {
  AddMemberDto,
  CreateOrganizationDto,
  OrganizationQueryDto,
  UpdateOrganizationDto,
} from './organizations.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  /** Public: used by the portal's organization filter (names only). */
  @Public()
  @Get()
  list(@Query() q: OrganizationQueryDto) {
    return this.orgs.list({ ...q, includeInactive: false });
  }

  @RequirePermissions('organization:view')
  @Get('admin')
  adminList(@Query() q: OrganizationQueryDto) {
    return this.orgs.list(q);
  }

  @RequirePermissions('organization:view')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orgs.get(id);
  }

  @RequirePermissions('organization:create')
  @Post()
  create(@Body() dto: CreateOrganizationDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.orgs.create(dto, u, m);
  }

  @RequirePermissions('organization:update')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrganizationDto,
    @CurrentUser() u: AuthUser,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.orgs.update(id, dto, u, m);
  }

  @RequirePermissions('organization:delete')
  @Post(':id/deactivate')
  deactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.orgs.deactivate(id, u, m);
  }

  @RequirePermissions('organization:update')
  @Post(':id/members')
  addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMemberDto,
    @CurrentUser() u: AuthUser,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.orgs.addMember(id, dto, u, m);
  }

  @RequirePermissions('organization:update')
  @Delete(':id/members/:memberId')
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentUser() u: AuthUser,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.orgs.removeMember(id, memberId, u, m);
  }
}
