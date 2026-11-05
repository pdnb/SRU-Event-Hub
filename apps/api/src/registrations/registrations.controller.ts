import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Idempotent, Public, ReqMeta, RequestMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../auth/auth.types';
import {
  BillingUpdateDto,
  CancelDto,
  CreateRegistrationDto,
  ExportQueryDto,
  RegistrationQueryDto,
  TokenBillingDto,
  TokenCancelDto,
  TokenLookupDto,
} from './registrations.dto';
import { RegistrationsService } from './registrations.service';

@ApiTags('registrations')
@Controller()
export class RegistrationsController {
  constructor(private readonly regs: RegistrationsService) {}

  @Public()
  @Idempotent()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'ลงทะเบียนเข้าร่วมกิจกรรม (รองรับผู้ไม่เข้าสู่ระบบในกิจกรรมที่อนุญาต)' })
  @Post('events/:id/registrations')
  register(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRegistrationDto,
    @CurrentUser() u: AuthUser | undefined,
    @ReqMeta() m: RequestMeta,
  ) {
    return this.regs.register(id, dto, u, m);
  }

  @RequirePermissions('registration:view')
  @Get('events/:id/registrations')
  list(@Param('id', ParseUUIDPipe) id: string, @Query() q: RegistrationQueryDto, @CurrentUser() u: AuthUser) {
    return this.regs.listForEvent(id, q, u);
  }

  @RequirePermissions('registration:export')
  @Get('events/:id/registrations/export')
  export(@Param('id', ParseUUIDPipe) id: string, @Query() q: ExportQueryDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.regs.export(id, q, u, m);
  }

  @Get('me/registrations')
  mine(@CurrentUser() u: AuthUser) {
    return this.regs.mine(u);
  }

  @Post('registrations/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.regs.cancelById(id, dto.reason, u, m);
  }

  /** Status check without login. POST so the secret token never lands in URLs or access logs. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('public/registrations/lookup')
  @HttpCode(200)
  lookup(@Body() dto: TokenLookupDto) {
    return this.regs.lookupByToken(dto.referenceNo, dto.token);
  }

  /** FIN-9: who the official receipt is made out to (registrant or the organizer's finance officer). */
  @Patch('registrations/:id/billing')
  billing(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BillingUpdateDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.regs.updateBilling(id, dto.billing, u, m);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('public/registrations/billing')
  @HttpCode(200)
  billingByToken(@Body() dto: TokenBillingDto, @ReqMeta() m: RequestMeta) {
    return this.regs.updateBillingByToken(dto.referenceNo, dto.token, dto.billing, m);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('public/registrations/cancel')
  @HttpCode(200)
  cancelByToken(@Body() dto: TokenCancelDto, @ReqMeta() m: RequestMeta) {
    return this.regs.cancelByToken(dto.referenceNo, dto.token, dto.reason, m);
  }
}
