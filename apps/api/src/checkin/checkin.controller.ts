import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsEmail } from 'class-validator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public, ReqMeta, RequestMeta, RequirePermissions } from '../common/decorators';
import { AttendanceService } from './attendance.service';
import {
  AttendanceExportDto,
  AttendanceQueryDto,
  AttendanceSetDto,
  CheckinSearchDto,
  CheckinSettingsDto,
  GroupCheckinDto,
  LocationDto,
  LocationUpdateDto,
  ManualCheckinDto,
  PersonnelDto,
  PersonnelUpdateDto,
  RecordQueryDto,
  ReissueDto,
  ScanDto,
  ScheduleDto,
  SyncDto,
  TokenQrDto,
  UndoDto,
} from './checkin.dto';
import { CheckinService } from './checkin.service';
import { PersonnelService } from './personnel.service';

class EmailQueryDto {
  @IsEmail() email!: string;
}

@ApiTags('checkin')
@Controller()
export class CheckinController {
  constructor(private readonly checkin: CheckinService) {}

  @ApiOperation({ summary: 'กิจกรรมที่ผู้ใช้เปิดจุดเช็กอิน / พิมพ์ป้ายชื่อได้ (ตามขอบเขตสิทธิ์ หรือได้รับมอบหมายเป็นบุคลากรของงาน)' })
  @Get('me/desk-events')
  deskEvents(@Query('purpose') purpose: string | undefined, @CurrentUser() u: AuthUser) {
    return this.checkin.myEvents(u, purpose === 'badge' ? 'badge' : 'checkin');
  }

  // ── settings / locations ──
  @RequirePermissions('checkin:view')
  @Get('events/:id/checkin/settings')
  settings(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.checkin.settings(id, u);
  }

  @RequirePermissions('checkin:update')
  @Put('events/:id/checkin/settings')
  updateSettings(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CheckinSettingsDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.checkin.updateSettings(id, dto, u, m);
  }

  @RequirePermissions('checkin:update')
  @Post('events/:id/checkin/locations')
  createLocation(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LocationDto, @CurrentUser() u: AuthUser) {
    return this.checkin.createLocation(id, dto, u);
  }

  @RequirePermissions('checkin:update')
  @Patch('checkin/locations/:id')
  updateLocation(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LocationUpdateDto, @CurrentUser() u: AuthUser) {
    return this.checkin.updateLocation(id, dto, u);
  }

  // ── sessions ──
  @RequirePermissions('event:update')
  @Post('events/:id/schedules')
  createSchedule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ScheduleDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.checkin.createSchedule(id, dto, u, m);
  }

  @RequirePermissions('event:update')
  @Put('event-schedules/:id')
  updateSchedule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ScheduleDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.checkin.updateSchedule(id, dto, u, m);
  }

  @RequirePermissions('event:update')
  @Delete('event-schedules/:id')
  deleteSchedule(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.checkin.deleteSchedule(id, u, m);
  }

  // ── desk ──
  @RequirePermissions('checkin:create')
  @ApiOperation({ summary: 'สแกน QR (ผู้ลงทะเบียน → เช็กอิน, QR กลุ่ม → คืนรายชื่อสมาชิก)' })
  @Post('events/:id/checkin/scan')
  @HttpCode(200)
  scan(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ScanDto, @CurrentUser() u: AuthUser) {
    return this.checkin.scan(id, dto, u);
  }

  @RequirePermissions('checkin:create')
  @Post('events/:id/checkin/manual')
  @HttpCode(200)
  manual(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ManualCheckinDto, @CurrentUser() u: AuthUser) {
    return this.checkin.manual(id, dto, u);
  }

  @RequirePermissions('checkin:create')
  @Post('events/:id/checkin/group')
  @HttpCode(200)
  group(@Param('id', ParseUUIDPipe) id: string, @Body() dto: GroupCheckinDto, @CurrentUser() u: AuthUser) {
    return this.checkin.group(id, dto, u);
  }

  @RequirePermissions('checkin:create')
  @ApiOperation({ summary: 'ส่งรายการที่บันทึกระหว่างออฟไลน์ (idempotent ตาม clientKey)' })
  @Post('events/:id/checkin/sync')
  @HttpCode(200)
  sync(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SyncDto, @CurrentUser() u: AuthUser) {
    return this.checkin.sync(id, dto.items, u);
  }

  @RequirePermissions('checkin:create')
  @Get('events/:id/checkin/offline-pack')
  offlinePack(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.checkin.offlinePack(id, u);
  }

  @RequirePermissions('checkin:view')
  @Get('events/:id/checkin/search')
  search(@Param('id', ParseUUIDPipe) id: string, @Query() q: CheckinSearchDto, @CurrentUser() u: AuthUser) {
    return this.checkin.search(id, q.q, u);
  }

  @RequirePermissions('checkin:view')
  @Get('events/:id/checkin/groups/:groupId')
  groupRoster(@Param('id', ParseUUIDPipe) id: string, @Param('groupId', ParseUUIDPipe) groupId: string, @Query('scheduleId') scheduleId: string | undefined, @CurrentUser() u: AuthUser) {
    return this.checkin.groupRosterFor(id, groupId, scheduleId ?? null, u);
  }

  @RequirePermissions('checkin:view')
  @Get('events/:id/checkin/stats')
  stats(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.checkin.stats(id, u);
  }

  @RequirePermissions('checkin:view')
  @Get('events/:id/checkin/records')
  records(@Param('id', ParseUUIDPipe) id: string, @Query() q: RecordQueryDto, @CurrentUser() u: AuthUser) {
    return this.checkin.records(id, q, u);
  }

  @RequirePermissions('checkin:update')
  @Post('checkin/records/:id/undo')
  @HttpCode(200)
  undo(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UndoDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.checkin.undo(id, dto.reason, u, m);
  }

  // ── QR credentials ──
  @ApiOperation({ summary: 'QR เช็กอินของการลงทะเบียน (เจ้าของ หรือเจ้าหน้าที่)' })
  @Get('registrations/:id/checkin-qr')
  myQr(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.checkin.qrForRegistration(id, u);
  }

  @RequirePermissions('checkin:update')
  @Post('registrations/:id/checkin-qr/reissue')
  @HttpCode(200)
  reissue(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReissueDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.checkin.reissue(id, dto.reason, u, m);
  }

  /** POST so the access token never lands in URLs or access logs. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('public/registrations/checkin-qr')
  @HttpCode(200)
  guestQr(@Body() dto: TokenQrDto) {
    return this.checkin.qrForGuest(dto.referenceNo, dto.token);
  }

  @Get('groups/:id/checkin-qr')
  groupQr(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.checkin.qrForGroup(id, u);
  }
}

@ApiTags('attendance')
@Controller()
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @RequirePermissions('attendance:view')
  @Get('events/:id/attendance')
  list(@Param('id', ParseUUIDPipe) id: string, @Query() q: AttendanceQueryDto, @CurrentUser() u: AuthUser) {
    return this.attendance.list(id, q, u);
  }

  @RequirePermissions('attendance:export')
  @Get('events/:id/attendance/export')
  export(@Param('id', ParseUUIDPipe) id: string, @Query() q: AttendanceExportDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.attendance.export(id, q.scheduleId ?? null, u, m);
  }

  @RequirePermissions('attendance:update')
  @Put('events/:id/attendance/:registrationId')
  set(@Param('id', ParseUUIDPipe) id: string, @Param('registrationId', ParseUUIDPipe) registrationId: string, @Body() dto: AttendanceSetDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.attendance.set(id, registrationId, dto, u, m);
  }
}

@ApiTags('event-personnel')
@Controller()
export class PersonnelController {
  constructor(private readonly personnel: PersonnelService) {}

  @RequirePermissions('badge:view')
  @Get('events/:id/personnel')
  list(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.personnel.list(id, u);
  }

  @RequirePermissions('event:update')
  @Get('events/:id/personnel/user-lookup')
  lookup(@Param('id', ParseUUIDPipe) id: string, @Query() q: EmailQueryDto, @CurrentUser() u: AuthUser) {
    return this.personnel.lookupUser(id, q.email, u);
  }

  @RequirePermissions('event:update')
  @Post('events/:id/personnel')
  create(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PersonnelDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.personnel.create(id, dto, u, m);
  }

  @RequirePermissions('event:update')
  @Patch('event-personnel/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PersonnelUpdateDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.personnel.update(id, dto, u, m);
  }

  @RequirePermissions('event:update')
  @Delete('event-personnel/:id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.personnel.remove(id, u, m);
  }
}
