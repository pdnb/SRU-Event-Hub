import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public, ReqMeta, RequestMeta, RequirePermissions } from '../common/decorators';
import { AppError, Errors } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { FinancePaymentQueryDto, RejectDto, SubmitSlipDto, TokenSlipDto } from './payments.dto';
import { PaymentsService, type UploadedSlip } from './payments.service';

/** Hard transport cap; the configurable business limit (SLIP_MAX_BYTES) is enforced in StorageService. */
const UPLOAD = FileInterceptor('file', { limits: { fileSize: 20_000_000, files: 1, fields: 10 } });
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@ApiTags('payments')
@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly prisma: PrismaService,
  ) {}

  // ───────────── Payer ─────────────

  /** Guest / any payer: the registration's secret token authorises the upload. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'แนบหลักฐานการโอนเงิน (ใช้เลขอ้างอิง + token)' })
  @Post('public/registrations/slip')
  @UseInterceptors(UPLOAD)
  async slipByToken(@Body() dto: TokenSlipDto, @UploadedFile() file: UploadedSlip | undefined, @CurrentUser() u: AuthUser | undefined, @ReqMeta() m: RequestMeta) {
    const reg = await this.prisma.registration.findUnique({ where: { referenceNo: dto.referenceNo } });
    if (!reg?.accessTokenHash || reg.accessTokenHash !== sha256(dto.token)) {
      throw new AppError('NOT_FOUND', 'ไม่พบข้อมูลการลงทะเบียน', 404);
    }
    return this.payments.submitSlip(reg.id, file, dto, u?.id ?? null, m);
  }

  /** Logged-in registrant uploads for their own registration. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @Post('registrations/:id/slip')
  @UseInterceptors(UPLOAD)
  async slipByOwner(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitSlipDto, @UploadedFile() file: UploadedSlip | undefined, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    const reg = await this.prisma.registration.findUnique({ where: { id } });
    if (!reg || reg.userId !== u.id) throw Errors.notFound('การลงทะเบียน');
    return this.payments.submitSlip(reg.id, file, dto, u.id, m);
  }

  // ───────────── Finance ─────────────

  @RequirePermissions('payment:view')
  @ApiOperation({ summary: 'รายการชำระเงิน (กรองตามสถานะ/กิจกรรม) ตามขอบเขตหน่วยงาน' })
  @Get('finance/payments')
  list(@Query() q: FinancePaymentQueryDto, @CurrentUser() u: AuthUser) {
    return this.payments.financeList(q, u);
  }

  @RequirePermissions('payment:view')
  @Get('finance/payments/:id/slip')
  async slip(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    const s = await this.payments.slip(id, u);
    return new StreamableFile(s.bytes, { type: s.mimeType, disposition: `inline; filename="${s.name}"` });
  }

  @RequirePermissions('payment:verify')
  @Post('finance/payments/:id/verify')
  @HttpCode(200)
  verify(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.payments.verify(id, u, m);
  }

  @RequirePermissions('payment:verify')
  @Post('finance/payments/:id/reject')
  @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.payments.reject(id, dto.reason, u, m);
  }

  @RequirePermissions('payment:waive')
  @Post('finance/orders/:id/waive')
  @HttpCode(200)
  waive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.payments.waive(id, dto.reason, u, m);
  }
}
