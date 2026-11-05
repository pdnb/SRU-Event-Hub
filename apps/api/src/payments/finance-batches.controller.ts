import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Idempotent, ReqMeta, RequestMeta, RequirePermissions } from '../common/decorators';
import { FinanceBatchesService } from './finance-batches.service';
import { BatchQueryDto, CreateBatchDto, EligibleQueryDto, ExportFormatDto, RecordReceiptsDto, RejectDto } from './payments.dto';

@ApiTags('finance-batches')
@Controller('finance/batches')
export class FinanceBatchesController {
  constructor(private readonly batches: FinanceBatchesService) {}

  @RequirePermissions('receipt:void')
  @Post('receipts/:receiptId/void')
  @HttpCode(200)
  voidReceipt(@Param('receiptId', ParseUUIDPipe) receiptId: string, @Body() dto: RejectDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.batches.voidReceipt(receiptId, dto.reason, u, m);
  }

  @RequirePermissions('finance_batch:view')
  @Get()
  list(@Query() q: BatchQueryDto, @CurrentUser() u: AuthUser) {
    return this.batches.list(q, u);
  }

  @RequirePermissions('finance_batch:create')
  @ApiOperation({ summary: 'รายการที่ตรวจสอบแล้วและยังไม่ได้นำส่ง ของกิจกรรม' })
  @Get('eligible')
  eligible(@Query() q: EligibleQueryDto, @CurrentUser() u: AuthUser) {
    return this.batches.eligible(q.eventId, u);
  }

  @RequirePermissions('finance_batch:create')
  @Idempotent({ required: false })
  @Post()
  create(@Body() dto: CreateBatchDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.batches.create(dto, u, m);
  }

  @RequirePermissions('finance_batch:view')
  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.batches.detail(id, u);
  }

  @RequirePermissions('finance_batch:export')
  @ApiOperation({ summary: 'รายงานนำส่งเงิน (PDF / Excel) ตามแม่แบบใน system_settings' })
  @Get(':id/export')
  export(@Param('id', ParseUUIDPipe) id: string, @Query() q: ExportFormatDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.batches.export(id, q.format, u, m);
  }

  @RequirePermissions('finance_batch:submit')
  @Post(':id/submit')
  @HttpCode(200)
  submit(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.batches.submit(id, u, m);
  }

  @RequirePermissions('finance_batch:receive')
  @Post(':id/receive')
  @HttpCode(200)
  receive(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.batches.receive(id, u, m);
  }

  @RequirePermissions('finance_batch:receive')
  @Post(':id/return')
  @HttpCode(200)
  returnBatch(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.batches.returnBatch(id, dto.reason, u, m);
  }

  @RequirePermissions('receipt:create')
  @Post(':id/receipts')
  @HttpCode(200)
  receipts(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordReceiptsDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.batches.recordReceipts(id, dto, u, m);
  }
}
