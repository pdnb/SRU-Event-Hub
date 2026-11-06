import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '../auth/auth.types';
import { GuestAccessDto } from '../certificates/certificates.dto';
import { CurrentUser, Public, ReqMeta, RequestMeta, RequirePermissions } from '../common/decorators';
import { FormDto, FormStatusDto, FormUpdateDto, GuestSubmitDto, RespondQueryDto, SubmitDto } from './evaluations.dto';
import { EvaluationsService } from './evaluations.service';

@ApiTags('evaluations')
@Controller()
export class EvaluationsController {
  constructor(private readonly evals: EvaluationsService) {}

  // ── organiser ──
  @RequirePermissions('evaluation:view')
  @Get('events/:id/evaluation-forms')
  list(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.evals.list(id, u);
  }

  @RequirePermissions('evaluation:create')
  @ApiOperation({ summary: 'สร้างแบบประเมิน (ไม่ส่งคำถาม = ใช้ชุดคำถามความพึงพอใจมาตรฐาน)' })
  @Post('events/:id/evaluation-forms')
  create(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FormDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.evals.create(id, dto, u, m);
  }

  @RequirePermissions('evaluation:view')
  @Get('evaluation-forms/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.evals.get(id, u);
  }

  @RequirePermissions('evaluation:update')
  @Put('evaluation-forms/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FormUpdateDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.evals.update(id, dto, u, m);
  }

  @RequirePermissions('evaluation:update')
  @Post('evaluation-forms/:id/status')
  @HttpCode(200)
  status(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FormStatusDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.evals.setStatus(id, dto.status, u, m);
  }

  @RequirePermissions('evaluation:update')
  @Delete('evaluation-forms/:id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.evals.remove(id, u, m);
  }

  @RequirePermissions('evaluation:view')
  @Get('evaluation-forms/:id/summary')
  summary(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.evals.summary(id, u);
  }

  @RequirePermissions('evaluation:export')
  @Get('evaluation-forms/:id/export')
  export(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.evals.export(id, u, m);
  }

  // ── respondents (signed in) ──
  @ApiOperation({ summary: 'แบบประเมินของกิจกรรมที่ฉันลงทะเบียน' })
  @Get('me/evaluations')
  mine(@CurrentUser() u: AuthUser) {
    return this.evals.mine(u);
  }

  @Get('evaluation-forms/:id/respond')
  respondView(@Param('id', ParseUUIDPipe) id: string, @Query() q: RespondQueryDto, @CurrentUser() u: AuthUser) {
    return this.evals.respondView(id, q.registrationId, u);
  }

  @Post('evaluation-forms/:id/responses')
  submit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.evals.submit(id, dto.registrationId, dto.answers, u, m);
  }

  // ── guests (reference number + access token, POST so the token stays out of URLs) ──
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('public/registrations/evaluations')
  @HttpCode(200)
  guestForms(@Body() dto: GuestAccessDto) {
    return this.evals.guestForms(dto.referenceNo, dto.token);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('public/evaluation-forms/:id/view')
  @HttpCode(200)
  guestView(@Param('id', ParseUUIDPipe) id: string, @Body() dto: GuestAccessDto) {
    return this.evals.guestRespondView(id, dto.referenceNo, dto.token);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('public/evaluation-forms/:id/responses')
  guestSubmit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: GuestSubmitDto, @ReqMeta() m: RequestMeta) {
    return this.evals.guestSubmit(id, dto.referenceNo, dto.token, dto.answers, m);
  }
}
