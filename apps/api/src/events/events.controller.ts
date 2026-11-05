import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public, ReqMeta, RequestMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../auth/auth.types';
import { ApprovalsService } from '../approvals/approvals.service';
import {
  AdminEventQueryDto,
  CommentDto,
  CreateEventDto,
  FeeChangeDto,
  PublicEventQueryDto,
  ReasonDto,
  RequiredCommentDto,
  RescheduleDto,
  UpdateEventDto,
} from './events.dto';
import { EventsService } from './events.service';

@ApiTags('public')
@Controller('public/events')
export class PublicEventsController {
  constructor(private readonly events: EventsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'รายการกิจกรรมที่เผยแพร่ (portal)' })
  list(@Query() q: PublicEventQueryDto) {
    return this.events.publicList(q);
  }

  @Public()
  @Get(':idOrCode')
  get(@Param('idOrCode') idOrCode: string) {
    return this.events.publicGet(idOrCode);
  }
}

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly approvals: ApprovalsService,
  ) {}

  @RequirePermissions('event:view')
  @Get()
  list(@Query() q: AdminEventQueryDto, @CurrentUser() u: AuthUser) {
    return this.events.adminList(q, u);
  }

  @RequirePermissions('event:view')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.events.adminGet(id, u);
  }

  @RequirePermissions('event:create')
  @Post()
  create(@Body() dto: CreateEventDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.events.create(dto, u, m);
  }

  @RequirePermissions('event:update')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEventDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.events.update(id, dto, u, m);
  }

  @RequirePermissions('event:delete')
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.events.remove(id, u, m);
  }

  @RequirePermissions('event:view')
  @Get(':id/status-history')
  statusHistory(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.events.statusHistory(id, u);
  }

  // ── approval ──
  @RequirePermissions('event:update')
  @Post(':id/submit')
  @HttpCode(200)
  submit(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.approvals.submit(id, u, m);
  }

  @RequirePermissions('approval:approve')
  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CommentDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.approvals.decide(id, 'APPROVE', dto.comment, u, m);
  }

  @RequirePermissions('approval:approve')
  @Post(':id/reject')
  @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RequiredCommentDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.approvals.decide(id, 'REJECT', dto.comment, u, m);
  }

  @RequirePermissions('approval:approve')
  @Post(':id/return')
  @HttpCode(200)
  returnForEdit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RequiredCommentDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.approvals.decide(id, 'RETURN', dto.comment, u, m);
  }

  // ── fee change after approval (FEE_CHANGE) ──
  @RequirePermissions('event:update')
  @ApiOperation({ summary: 'ขอแก้ไขอัตราค่าลงทะเบียนหลังอนุมัติ (ต้องอนุมัติใหม่)' })
  @Post(':id/fee-change')
  feeChange(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FeeChangeDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.approvals.requestFeeChange(id, dto, u, m);
  }

  @Get(':id/fee-change')
  pendingFeeChange(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.approvals.pendingFeeChange(id, u);
  }

  @RequirePermissions('event:update')
  @Post(':id/fee-change/cancel')
  @HttpCode(200)
  cancelFeeChange(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.approvals.cancelFeeChange(id, u, m);
  }

  @Get(':id/approval-history')
  approvalHistory(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.approvals.history(id, u);
  }

  // ── lifecycle ──
  @RequirePermissions('event:update')
  @Post(':id/publish')
  @HttpCode(200)
  publish(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.events.publish(id, u, m);
  }

  @RequirePermissions('event:update')
  @Post(':id/open-registration')
  @HttpCode(200)
  open(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.events.openRegistration(id, u, m);
  }

  @RequirePermissions('event:update')
  @Post(':id/close-registration')
  @HttpCode(200)
  close(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.events.closeRegistration(id, u, m);
  }

  @RequirePermissions('event:update')
  @Post(':id/start')
  @HttpCode(200)
  start(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.events.start(id, u, m);
  }

  @RequirePermissions('event:update')
  @Post(':id/complete')
  @HttpCode(200)
  complete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.events.complete(id, u, m);
  }

  @RequirePermissions('event:update')
  @Post(':id/reschedule')
  @HttpCode(200)
  reschedule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RescheduleDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.events.reschedule(id, dto, u, m);
  }

  @RequirePermissions('event:delete')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.events.cancel(id, dto.reason, u, m);
  }
}
