import { Body, Controller, Delete, Get, Headers, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public, ReqMeta, RequestMeta, RequirePermissions } from '../common/decorators';
import { PageQueryDto } from '../common/pagination';
import { LineService } from './line.service';
import { NotificationsService } from './notifications.service';

class InboxQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(['true', 'false']) unread?: 'true' | 'false';
}
class PrefsDto {
  @IsOptional() @IsBoolean() email?: boolean;
  @IsOptional() @IsBoolean() line?: boolean;
}
class LogQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(['QUEUED', 'SENT', 'FAILED']) status?: string;
  @IsOptional() @IsIn(['EMAIL', 'LINE']) channel?: string;
}
class TemplateDto {
  @IsOptional() @IsString() @MaxLength(300) subject?: string | null;
  @IsString() @MinLength(1) @MaxLength(5000) body!: string;
  @IsOptional() @Type(() => Boolean) @IsBoolean() isActive?: boolean;
}

@ApiTags('notifications')
@Controller()
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly line: LineService,
  ) {}

  // ── inbox ──
  @Get('me/notifications')
  inbox(@Query() q: InboxQueryDto, @CurrentUser() u: AuthUser) {
    return this.notifications.inbox(u, q);
  }

  @SkipThrottle()
  @Get('me/notifications/unread-count')
  unread(@CurrentUser() u: AuthUser) {
    return this.notifications.unreadCount(u);
  }

  @Post('me/notifications/read-all')
  @HttpCode(200)
  readAll(@CurrentUser() u: AuthUser) {
    return this.notifications.markRead(u);
  }

  @Post('me/notifications/:id/read')
  @HttpCode(200)
  read(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.notifications.markRead(u, id);
  }

  // ── preferences / LINE ──
  @Get('me/notification-preferences')
  prefs(@CurrentUser() u: AuthUser) {
    return this.notifications.preferences(u);
  }

  @Put('me/notification-preferences')
  setPrefs(@Body() dto: PrefsDto, @CurrentUser() u: AuthUser) {
    return this.notifications.setPreferences(u, dto);
  }

  @ApiOperation({ summary: 'รหัส 8 หลัก (10 นาที) สำหรับส่งให้บัญชี LINE ทางการเพื่อเชื่อมบัญชี' })
  @Post('me/line/link-code')
  linkCode(@CurrentUser() u: AuthUser) {
    return this.notifications.lineLinkCode(u);
  }

  @Delete('me/line')
  unlink(@CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.notifications.unlinkLine(u, m);
  }

  /** LINE platform → us. Authenticated by the X-Line-Signature HMAC, not by session/CSRF. */
  @ApiExcludeEndpoint()
  @Public()
  @SkipThrottle()
  @Post('public/line/webhook')
  @HttpCode(200)
  async webhook(@Req() req: Request & { rawBody?: Buffer }, @Headers('x-line-signature') sig: string | undefined, @Body() body: { events?: unknown[] }) {
    if (!this.line.webhookEnabled) throw new NotFoundException();
    if (!this.line.verifySignature(req.rawBody, sig)) throw new UnauthorizedException();
    await this.notifications.handleLineEvents((Array.isArray(body?.events) ? body.events : []) as Parameters<NotificationsService['handleLineEvents']>[0]);
    return { ok: true };
  }

  // ── admin ──
  @RequirePermissions('system_setting:view')
  @Get('notification-logs')
  logs(@Query() q: LogQueryDto) {
    return this.notifications.logs(q);
  }

  @RequirePermissions('system_setting:update')
  @Post('notification-logs/:id/retry')
  @HttpCode(200)
  retry(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.notifications.retry(id, u, m);
  }

  @RequirePermissions('system_setting:view')
  @Get('notification-templates')
  templates() {
    return this.notifications.templates();
  }

  @RequirePermissions('system_setting:update')
  @Put('notification-templates/:code/:channel')
  saveTemplate(@Param('code') code: string, @Param('channel') channel: string, @Body() dto: TemplateDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    if (!['IN_APP', 'EMAIL', 'LINE'].includes(channel)) throw new NotFoundException();
    return this.notifications.saveTemplate(code, channel as 'IN_APP' | 'EMAIL' | 'LINE', dto, u, m);
  }
}
