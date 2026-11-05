import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Idempotent, ReqMeta, RequestMeta, RequirePermissions } from '../common/decorators';
import { CashierService } from './cashier.service';
import {
  CashierQueryDto,
  CloseSessionDto,
  CollectDto,
  CreateRefundDto,
  ExportFormatDto,
  OpenSessionDto,
  PayablesQueryDto,
  PayRefundDto,
  RefundableQueryDto,
  RefundQueryDto,
  RejectDto,
  RemitDto,
} from './payments.dto';
import { RefundsService } from './refunds.service';

@ApiTags('finance-cashier')
@Controller('finance/cashier-sessions')
export class CashierController {
  constructor(private readonly cashier: CashierService) {}

  @RequirePermissions('cashier:view')
  @Get()
  list(@Query() q: CashierQueryDto, @CurrentUser() u: AuthUser) {
    return this.cashier.list(q, u);
  }

  @RequirePermissions('cashier:collect')
  @ApiOperation({ summary: 'เปิดกะรับเงินหน้างาน' })
  @Post()
  open(@Body() dto: OpenSessionDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.cashier.open(dto, u, m);
  }

  @RequirePermissions('cashier:view')
  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.cashier.detail(id, u);
  }

  @RequirePermissions('cashier:collect')
  @Get(':id/payables')
  payables(@Param('id', ParseUUIDPipe) id: string, @Query() q: PayablesQueryDto, @CurrentUser() u: AuthUser) {
    return this.cashier.payables(id, q, u);
  }

  /** Idempotency-Key required: a double tap must never record cash twice. */
  @RequirePermissions('cashier:collect')
  @Idempotent()
  @ApiOperation({ summary: 'รับชำระเงินสดหน้างาน (ยอดตามใบแจ้งชำระ)' })
  @Post(':id/collect')
  collect(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CollectDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.cashier.collect(id, dto.orderId, u, m, dto.capturedAt);
  }

  @RequirePermissions('cashier:collect')
  @ApiOperation({ summary: 'รายชื่อค้างชำระทั้งหมดสำหรับโหมดออฟไลน์ (FIN-12)' })
  @Get(':id/offline-pack')
  offlinePack(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.cashier.offlinePack(id, u);
  }

  @RequirePermissions('cashier:collect')
  @ApiOperation({ summary: 'รายชื่อค้างชำระแบบกระดาษ (PDF) สำรองกรณีอุปกรณ์ขัดข้อง' })
  @Get(':id/offline-sheet')
  offlineSheet(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.cashier.offlineSheet(id, u, m);
  }

  @RequirePermissions('cashier:view')
  @ApiOperation({ summary: 'ใบนำส่งเงินสด (PDF / Excel) ตามแม่แบบใน system_settings' })
  @Get(':id/remittance-document')
  remittanceDocument(@Param('id', ParseUUIDPipe) id: string, @Query() q: ExportFormatDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.cashier.remittanceDocument(id, q.format, u, m);
  }

  @RequirePermissions('cashier:collect')
  @Post(':id/close')
  @HttpCode(200)
  close(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseSessionDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.cashier.close(id, dto, u, m);
  }

  @RequirePermissions('cashier:view')
  @Post(':id/remit')
  @HttpCode(200)
  remit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RemitDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.cashier.remit(id, dto, u, m);
  }

  @RequirePermissions('cashier:approve')
  @Post(':id/confirm')
  @HttpCode(200)
  confirm(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.cashier.confirm(id, u, m);
  }

  @RequirePermissions('cashier:void')
  @ApiOperation({ summary: 'ยกเลิกรายการรับเงินสด (ผู้อนุมัติ ≠ ผู้รับเงิน)' })
  @Post('payments/:paymentId/void')
  @HttpCode(200)
  void(@Param('paymentId', ParseUUIDPipe) paymentId: string, @Body() dto: RejectDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.cashier.voidPayment(paymentId, dto.reason, u, m);
  }
}

@ApiTags('finance-refunds')
@Controller('finance/refunds')
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @RequirePermissions('refund:view')
  @Get()
  list(@Query() q: RefundQueryDto, @CurrentUser() u: AuthUser) {
    return this.refunds.list(q, u);
  }

  @RequirePermissions('refund:create')
  @Get('refundable')
  refundable(@Query() q: RefundableQueryDto, @CurrentUser() u: AuthUser) {
    return this.refunds.refundable(q.eventId, q.search, u);
  }

  @RequirePermissions('refund:create')
  @Idempotent({ required: false })
  @Post()
  create(@Body() dto: CreateRefundDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.refunds.create(dto, u, m);
  }

  @RequirePermissions('refund:approve')
  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.refunds.approve(id, u, m);
  }

  @RequirePermissions('refund:approve')
  @Post(':id/reject')
  @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.refunds.reject(id, dto.reason, u, m);
  }

  @RequirePermissions('refund:refund')
  @Post(':id/pay')
  @HttpCode(200)
  pay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PayRefundDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.refunds.pay(id, dto, u, m);
  }

  /** POST (not GET) so the decrypted number never lands in URLs, caches or access logs. */
  @RequirePermissions('refund:refund')
  @Post(':id/reveal-account')
  @HttpCode(200)
  reveal(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.refunds.revealAccount(id, u, m);
  }
}
