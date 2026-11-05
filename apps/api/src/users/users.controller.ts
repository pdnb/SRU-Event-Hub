import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../auth/auth.types';
import { CreateUserDto, GrantRoleDto, UpdateUserStatusDto, UserQueryDto } from './users.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @RequirePermissions('user:view')
  @Get('users')
  list(@Query() q: UserQueryDto, @CurrentUser() u: AuthUser) {
    return this.users.list(q, u);
  }

  @RequirePermissions('user:view')
  @Get('users/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @RequirePermissions('user:create')
  @Post('users')
  create(@Body() dto: CreateUserDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.users.create(dto, u, m);
  }

  @RequirePermissions('user:update')
  @Patch('users/:id/status')
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() u: AuthUser,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.users.setStatus(id, dto, u, m);
  }

  @RequirePermissions('role:update')
  @Post('users/:id/roles')
  grant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GrantRoleDto,
    @CurrentUser() u: AuthUser,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.users.grantRole(id, dto, u, m);
  }

  @RequirePermissions('role:update')
  @Delete('users/:id/roles/:grantId')
  revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @CurrentUser() u: AuthUser,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.users.revokeRole(id, grantId, u, m);
  }

  @RequirePermissions('role:view')
  @Get('roles')
  roles() {
    return this.users.listRoles();
  }
}
