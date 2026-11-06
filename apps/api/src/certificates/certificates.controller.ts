import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public, ReqMeta, RequestMeta, RequirePermissions } from '../common/decorators';
import { AppError } from '../common/errors';
import {
  BatchPdfDto,
  CertCandidateQueryDto,
  CertListQueryDto,
  CertPreviewDto,
  CertTemplateDto,
  CertTemplateUpdateDto,
  ClaimDto,
  GuestAccessDto,
  GuestClaimDto,
  GuestPdfDto,
  IssueDto,
  RevokeDto,
} from './certificates.dto';
import { CertificatesService } from './certificates.service';

const UPLOAD = FileInterceptor('file', { limits: { fileSize: 10_000_000, files: 1, fields: 5 } });

@ApiTags('certificates')
@Controller()
export class CertificatesController {
  constructor(private readonly certs: CertificatesService) {}

  @RequirePermissions('certificate:view')
  @Get('certificates/placeholders')
  placeholders() {
    return this.certs.placeholders();
  }

  // ── templates ──
  @RequirePermissions('certificate:view')
  @Get('events/:id/certificate-templates')
  listTemplates(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.certs.listTemplates(id, u);
  }

  @RequirePermissions('certificate:create')
  @Post('events/:id/certificate-templates')
  createTemplate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CertTemplateDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.certs.createTemplate(id, dto, u, m);
  }

  @RequirePermissions('certificate:view')
  @ApiOperation({ summary: 'PDF ตัวอย่างจากแม่แบบที่ยังไม่บันทึก' })
  @Post('events/:id/certificate-templates/preview')
  @HttpCode(200)
  preview(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CertPreviewDto, @CurrentUser() u: AuthUser) {
    return this.certs.preview(id, dto.template, dto.templateId, u);
  }

  @RequirePermissions('certificate:view')
  @Get('certificate-templates/:id')
  getTemplate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.certs.getTemplate(id, u);
  }

  @RequirePermissions('certificate:update')
  @Put('certificate-templates/:id')
  updateTemplate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CertTemplateUpdateDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.certs.updateTemplate(id, dto, u, m);
  }

  @RequirePermissions('certificate:update')
  @Delete('certificate-templates/:id')
  removeTemplate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.certs.removeTemplate(id, u, m);
  }

  @RequirePermissions('certificate:update')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(UPLOAD)
  @Post('certificate-templates/:id/background')
  setBackground(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    if (!file) throw new AppError('FILE_EMPTY', 'กรุณาแนบไฟล์ภาพ');
    return this.certs.setBackground(id, file.buffer, file.originalname, u, m);
  }

  @RequirePermissions('certificate:view')
  @Get('certificate-templates/:id/background')
  background(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.certs.background(id, u);
  }

  // ── issue / manage ──
  @RequirePermissions('certificate:view')
  @ApiOperation({ summary: 'รายชื่อผู้มีสิทธิ์รับเกียรติบัตรของแม่แบบ พร้อมผลตรวจเกณฑ์' })
  @Get('events/:id/certificates/candidates')
  candidates(@Param('id', ParseUUIDPipe) id: string, @Query() q: CertCandidateQueryDto, @CurrentUser() u: AuthUser) {
    return this.certs.candidates(id, q, u);
  }

  @RequirePermissions('certificate:create')
  @Post('events/:id/certificates/issue')
  @HttpCode(200)
  issue(@Param('id', ParseUUIDPipe) id: string, @Body() dto: IssueDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.certs.issue(id, dto, u, m);
  }

  @RequirePermissions('certificate:view')
  @Get('events/:id/certificates')
  list(@Param('id', ParseUUIDPipe) id: string, @Query() q: CertListQueryDto, @CurrentUser() u: AuthUser) {
    return this.certs.list(id, q, u);
  }

  @RequirePermissions('certificate:export')
  @Get('events/:id/certificates/export')
  export(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.certs.export(id, u, m);
  }

  @RequirePermissions('certificate:export')
  @ApiOperation({ summary: 'รวมเกียรติบัตรหลายฉบับเป็น PDF เดียว (ไม่เกิน 500)' })
  @Post('events/:id/certificates/pdf')
  @HttpCode(200)
  batchPdf(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BatchPdfDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.certs.batchPdf(id, dto, u, m);
  }

  @RequirePermissions('certificate:void')
  @Post('certificates/:id/revoke')
  @HttpCode(200)
  revoke(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RevokeDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.certs.revoke(id, dto.reason, u, m);
  }

  @ApiOperation({ summary: 'PDF เกียรติบัตร (ผู้รับ หรือเจ้าหน้าที่ที่มีสิทธิ์ certificate:view)' })
  @Get('certificates/:id/pdf')
  pdf(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.certs.pdf(id, u, m);
  }

  // ── participants ──
  @ApiOperation({ summary: 'เกียรติบัตรของฉัน + ที่ขอรับได้' })
  @Get('me/certificates')
  mine(@CurrentUser() u: AuthUser) {
    return this.certs.mine(u);
  }

  @Post('me/certificates/claim')
  claim(@Body() dto: ClaimDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.certs.claim(dto.templateId, dto.registrationId, u, m);
  }

  // ── guests (reference number + access token; POST keeps the token out of URLs) ──
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('public/registrations/certificates')
  @HttpCode(200)
  guestMine(@Body() dto: GuestAccessDto) {
    return this.certs.guestMine(dto.referenceNo, dto.token);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('public/registrations/certificates/claim')
  guestClaim(@Body() dto: GuestClaimDto, @ReqMeta() m: RequestMeta) {
    return this.certs.guestClaim(dto.referenceNo, dto.token, dto.templateId, m);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('public/registrations/certificates/pdf')
  @HttpCode(200)
  guestPdf(@Body() dto: GuestPdfDto, @ReqMeta() m: RequestMeta) {
    return this.certs.guestPdf(dto.referenceNo, dto.token, dto.certificateId, m);
  }

  /** Public verification — the QR on a certificate opens the web page that calls this. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('public/certificates/verify/:code')
  verify(@Param('code') code: string, @ReqMeta() m: RequestMeta) {
    return this.certs.verify(String(code).slice(0, 40), m.ip);
  }
}
