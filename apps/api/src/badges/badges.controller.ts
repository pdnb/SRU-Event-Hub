import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/decorators';
import { AppError } from '../common/errors';
import { BadgePreviewDto, BadgeTemplateDto, BadgeTemplateUpdateDto, CandidateQueryDto, PrintJobDto } from './badges.dto';
import { BadgesService } from './badges.service';

const UPLOAD = FileInterceptor('file', { limits: { fileSize: 10_000_000, files: 1, fields: 5 } });

@ApiTags('badges')
@Controller()
export class BadgesController {
  constructor(private readonly badges: BadgesService) {}

  @RequirePermissions('badge:view')
  @Get('badges/placeholders')
  placeholders() {
    return this.badges.placeholders();
  }

  // ── templates ──
  @RequirePermissions('badge:view')
  @Get('events/:id/badge-templates')
  list(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.badges.list(id, u);
  }

  @RequirePermissions('badge:create')
  @Post('events/:id/badge-templates')
  create(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BadgeTemplateDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.badges.create(id, dto, u, m);
  }

  @RequirePermissions('badge:view')
  @ApiOperation({ summary: 'PDF ตัวอย่างจากแม่แบบที่ยังไม่บันทึก (ใช้ข้อมูลผู้ลงทะเบียนจริง 2–3 คน หรือข้อมูลตัวอย่าง)' })
  @Post('events/:id/badge-templates/preview')
  @HttpCode(200)
  preview(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BadgePreviewDto, @CurrentUser() u: AuthUser) {
    return this.badges.preview(id, dto.template, dto.templateId, u);
  }

  @RequirePermissions('badge:view')
  @Get('badge-templates/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.badges.get(id, u);
  }

  @RequirePermissions('badge:update')
  @Put('badge-templates/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BadgeTemplateUpdateDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.badges.update(id, dto, u, m);
  }

  @RequirePermissions('badge:update')
  @Delete('badge-templates/:id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.badges.remove(id, u, m);
  }

  @RequirePermissions('badge:update')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(UPLOAD)
  @Post('badge-templates/:id/background')
  setBackground(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    if (!file) throw new AppError('FILE_EMPTY', 'กรุณาแนบไฟล์ภาพ');
    return this.badges.setBackground(id, file.buffer, file.originalname, u, m);
  }

  @RequirePermissions('badge:view')
  @Get('badge-templates/:id/background')
  background(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.badges.background(id, u);
  }

  // ── printing ──
  @RequirePermissions('badge:view')
  @Get('events/:id/badges/candidates')
  candidates(@Param('id', ParseUUIDPipe) id: string, @Query() q: CandidateQueryDto, @CurrentUser() u: AuthUser) {
    return this.badges.candidates(id, q, u);
  }

  @RequirePermissions('badge:print')
  @ApiOperation({ summary: 'สร้างงานพิมพ์ป้ายชื่อ (ชุด / ทันที / ซ้ำ) — บันทึกทุกป้ายที่พิมพ์' })
  @Post('events/:id/badge-print-jobs')
  createJob(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PrintJobDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.badges.createJob(id, dto, u, m);
  }

  @RequirePermissions('badge:view')
  @Get('events/:id/badge-print-jobs')
  jobs(@Param('id', ParseUUIDPipe) id: string, @Query() q: CandidateQueryDto, @CurrentUser() u: AuthUser) {
    return this.badges.jobs(id, q, u);
  }

  @RequirePermissions('badge:print')
  @Get('badge-print-jobs/:id/pdf')
  pdf(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.badges.pdf(id, u, m);
  }

  @RequirePermissions('badge:view')
  @Get('registrations/:id/badge-history')
  regHistory(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.badges.history({ registrationId: id }, u);
  }

  @RequirePermissions('badge:view')
  @Get('event-personnel/:id/badge-history')
  personnelHistory(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.badges.history({ personnelId: id }, u);
  }
}
