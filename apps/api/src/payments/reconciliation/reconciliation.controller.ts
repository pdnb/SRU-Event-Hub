import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../auth/auth.types';
import { CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../../common/decorators';
import { LineReasonDto, MatchLineDto, ReconAccountDto, ReconLineQueryDto, ReconReportQueryDto } from './reconciliation.dto';
import { ReconciliationService } from './reconciliation.service';

const UPLOAD = FileInterceptor('file', { limits: { fileSize: 6_000_000, files: 1, fields: 5 } });

/** กระทบยอดกับ statement ธนาคาร (finance_batch:reconcile). */
@ApiTags('finance-reconciliation')
@RequirePermissions('finance_batch:reconcile')
@Controller('finance/reconciliation')
export class ReconciliationController {
  constructor(private readonly recon: ReconciliationService) {}

  @Get('accounts')
  accounts(@CurrentUser() u: AuthUser) {
    return this.recon.accounts(u);
  }

  @Get('template')
  template() {
    return new StreamableFile(Buffer.from(this.recon.template(), 'utf8'), { type: 'text/csv; charset=utf-8', disposition: 'attachment; filename="statement-template.csv"' });
  }

  @Get('statements')
  statements(@Query() q: ReconAccountDto, @CurrentUser() u: AuthUser) {
    return this.recon.statements(q.bankAccountId, u);
  }

  @ApiOperation({ summary: 'นำเข้า statement (CSV/XLSX) แล้วจับคู่อัตโนมัติ' })
  @ApiConsumes('multipart/form-data')
  @Post('statements')
  @UseInterceptors(UPLOAD)
  upload(@Body() dto: ReconAccountDto, @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.recon.upload(dto.bankAccountId, file, u, m);
  }

  @Post('auto-match')
  @HttpCode(200)
  autoMatch(@Body() dto: ReconAccountDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.recon.autoMatch(dto.bankAccountId, u, m);
  }

  @Get('lines')
  lines(@Query() q: ReconLineQueryDto, @CurrentUser() u: AuthUser) {
    return this.recon.lines(q, u);
  }

  @Get('lines/:id/candidates')
  candidates(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.recon.candidates(id, u);
  }

  @Post('lines/:id/match')
  @HttpCode(200)
  match(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MatchLineDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.recon.match(id, dto.paymentId, u, m);
  }

  @Post('lines/:id/unmatch')
  @HttpCode(200)
  unmatch(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LineReasonDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.recon.unmatch(id, dto.reason, u, m);
  }

  @Post('lines/:id/ignore')
  @HttpCode(200)
  ignore(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LineReasonDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.recon.ignore(id, dto.reason, u, m);
  }

  @ApiOperation({ summary: 'รายงานกระทบยอด: เงินเข้าที่ไม่พบรายการ / รายการที่ไม่พบในบัญชี' })
  @Get('report')
  report(@Query() q: ReconReportQueryDto, @CurrentUser() u: AuthUser) {
    return this.recon.report(q, u);
  }
}
