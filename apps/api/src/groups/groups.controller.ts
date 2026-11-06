import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Idempotent, Public, ReqMeta, RequestMeta, RequirePermissions } from '../common/decorators';
import { SubmitSlipDto } from '../payments/payments.dto';
import { PaymentsService, type UploadedSlip } from '../payments/payments.service';
import { GroupImportsService } from './group-imports.service';
import { GroupInvitationsService } from './group-invitations.service';
import {
  AcceptInvitationDto,
  AddCoordinatorDto,
  CreateGroupDto,
  CreateInvitationDto,
  GroupBillingDto,
  GroupQueryDto,
  GroupSettingDto,
  InvitationTokenDto,
  MemberDto,
  ParticipantOrgDto,
  ParticipantOrgQueryDto,
  ReasonDto,
  SubmitGroupDto,
  UpdateGroupDto,
  UpdateMemberDto,
} from './groups.dto';
import { GroupsService } from './groups.service';
import { ParticipantOrgsService } from './participant-orgs.service';

const SLIP = FileInterceptor('file', { limits: { fileSize: 20_000_000, files: 1, fields: 10 } });
const XLSX = FileInterceptor('file', { limits: { fileSize: 6_000_000, files: 1, fields: 5 } });

/** Participant organizations (องค์กรผู้ส่งเข้าร่วม) and their coordinators. */
@ApiTags('groups')
@Controller()
export class ParticipantOrgsController {
  constructor(private readonly orgs: ParticipantOrgsService) {}

  @Get('me/participant-orgs')
  mine(@CurrentUser() u: AuthUser) {
    return this.orgs.mine(u);
  }

  @ApiOperation({ summary: 'สร้างองค์กรผู้ส่งเข้าร่วม (ผู้สร้างเป็นผู้ประสานงาน)' })
  @Post('participant-orgs')
  create(@Body() dto: ParticipantOrgDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.orgs.create(dto, u, m);
  }

  @Put('participant-orgs/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ParticipantOrgDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.orgs.update(id, dto, u, m);
  }

  @Post('participant-orgs/:id/coordinators')
  addCoordinator(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddCoordinatorDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.orgs.addCoordinator(id, dto, u, m);
  }

  @Delete('participant-orgs/:id/coordinators/:userId')
  removeCoordinator(@Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.orgs.removeCoordinator(id, userId, u, m);
  }

  @RequirePermissions('participant_org:view')
  @Get('participant-orgs')
  list(@Query() q: ParticipantOrgQueryDto) {
    return this.orgs.list(q);
  }

  @RequirePermissions('participant_org:approve')
  @Post('participant-orgs/:id/verify')
  @HttpCode(200)
  verify(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.orgs.verify(id, true, u, m);
  }

  @RequirePermissions('participant_org:approve')
  @Post('participant-orgs/:id/unverify')
  @HttpCode(200)
  unverify(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.orgs.verify(id, false, u, m);
  }
}

@ApiTags('groups')
@Controller()
export class GroupsController {
  constructor(
    private readonly groups: GroupsService,
    private readonly invitations: GroupInvitationsService,
    private readonly imports: GroupImportsService,
    private readonly payments: PaymentsService,
  ) {}

  // ───────────── Event settings ─────────────

  @Public()
  @Get('public/events/:id/group-settings')
  publicSettings(@Param('id', ParseUUIDPipe) id: string) {
    return this.groups.settings(id);
  }

  @RequirePermissions('group:update')
  @Put('events/:id/group-settings')
  updateSettings(@Param('id', ParseUUIDPipe) id: string, @Body() dto: GroupSettingDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.groups.updateSettings(id, dto, u, m);
  }

  @RequirePermissions('group:view')
  @Get('events/:id/groups')
  listForEvent(@Param('id', ParseUUIDPipe) id: string, @Query() q: GroupQueryDto, @CurrentUser() u: AuthUser) {
    return this.groups.listForEvent(id, q, u);
  }

  // ───────────── Coordinator ─────────────

  @Idempotent()
  @ApiOperation({ summary: 'สร้างกลุ่มลงทะเบียน (ฉบับร่าง) ในนามองค์กร' })
  @Post('events/:id/groups')
  create(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateGroupDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.groups.create(id, dto, u, m);
  }

  @Get('me/groups')
  mine(@CurrentUser() u: AuthUser) {
    return this.groups.mine(u);
  }

  @Get('groups/:id')
  detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.groups.detail(id, u);
  }

  @Patch('groups/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGroupDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.groups.update(id, dto, u, m);
  }

  @Get('groups/:id/change-logs')
  changeLogs(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.groups.changeLogs(id, u);
  }

  @Post('groups/:id/members')
  addMember(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MemberDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.groups.addMemberByCoordinator(id, dto, u, m);
  }

  @Put('groups/:id/members/:memberId')
  updateMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateMemberDto,
    @CurrentUser() u: AuthUser,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.groups.updateMember(id, memberId, dto, u.id, m, { asCoordinator: u });
  }

  @Post('groups/:id/members/:memberId/remove')
  @HttpCode(200)
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: ReasonDto,
    @CurrentUser() u: AuthUser,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.groups.removeMember(id, memberId, dto.reason, u, m);
  }

  @Idempotent()
  @ApiOperation({ summary: 'ส่งกลุ่ม — สำรองที่นั่งของสมาชิกทุกคนพร้อมกัน (ทั้งหมดหรือไม่เลย) และออกใบแจ้งชำระรวม' })
  @Post('groups/:id/submit')
  @HttpCode(200)
  submit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitGroupDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.groups.submit(id, dto, u, m);
  }

  @Post('groups/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.groups.cancel(id, dto.reason, u, m);
  }

  // ───────────── Combined payment ─────────────

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @Post('groups/:id/slip')
  @UseInterceptors(SLIP)
  async slip(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitSlipDto, @UploadedFile() file: UploadedSlip | undefined, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    await this.groups.loadForCoordinator(id, u);
    return this.payments.submitSlip({ groupId: id }, file, dto, u.id, m);
  }

  @Patch('groups/:id/billing')
  async billing(@Param('id', ParseUUIDPipe) id: string, @Body() dto: GroupBillingDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.payments.updateBilling(await this.groups.liveOrderId(id, u), dto.billing, u.id, m);
  }

  // ───────────── Excel import ─────────────

  @Get('groups/:id/import-template')
  template(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.imports.template(id, u);
  }

  @ApiConsumes('multipart/form-data')
  @Post('groups/:id/imports')
  @UseInterceptors(XLSX)
  upload(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.imports.upload(id, file, u, m);
  }

  @Get('groups/:id/imports/:importId')
  getImport(@Param('id', ParseUUIDPipe) id: string, @Param('importId', ParseUUIDPipe) importId: string, @CurrentUser() u: AuthUser) {
    return this.imports.get(id, importId, u);
  }

  @Post('groups/:id/imports/:importId/commit')
  @HttpCode(200)
  commitImport(@Param('id', ParseUUIDPipe) id: string, @Param('importId', ParseUUIDPipe) importId: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.imports.commit(id, importId, u, m);
  }

  @Post('groups/:id/imports/:importId/discard')
  @HttpCode(200)
  discardImport(@Param('id', ParseUUIDPipe) id: string, @Param('importId', ParseUUIDPipe) importId: string, @CurrentUser() u: AuthUser) {
    return this.imports.discard(id, importId, u);
  }

  // ───────────── Invitations ─────────────

  @Post('groups/:id/invitations')
  createInvitation(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateInvitationDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.invitations.create(id, dto, u, m);
  }

  @Post('groups/:id/invitations/:invitationId/revoke')
  @HttpCode(200)
  revokeInvitation(@Param('id', ParseUUIDPipe) id: string, @Param('invitationId', ParseUUIDPipe) invitationId: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.invitations.revoke(id, invitationId, u, m);
  }

  /** POST so the token never lands in URLs or access logs (the page reads it from the URL fragment). */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('public/group-invitations/view')
  @HttpCode(200)
  viewInvitation(@Body() dto: InvitationTokenDto) {
    return this.invitations.view(dto.token);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('public/group-invitations/accept')
  @HttpCode(200)
  acceptInvitation(@Body() dto: AcceptInvitationDto, @CurrentUser() u: AuthUser | undefined, @ReqMeta() m: RequestMeta) {
    return this.invitations.accept(dto, u, m);
  }
}
