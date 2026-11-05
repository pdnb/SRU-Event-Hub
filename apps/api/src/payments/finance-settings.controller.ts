import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/decorators';
import { Errors } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { BankAccountDto, IncomeCodeDto } from './payments.dto';

/** Receiving bank accounts and income codes (managed by กองคลัง: bank_account:*, income_code:*). */
@ApiTags('finance-settings')
@Controller('finance')
export class FinanceSettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Active accounts + income codes for the event form (any signed-in staff; printed on invoices anyway). */
  @ApiOperation({ summary: 'ตัวเลือกบัญชีรับเงินและรหัสรายได้ที่ใช้งานอยู่' })
  @Get('options')
  async options() {
    const [bankAccounts, incomeCodes] = await Promise.all([
      this.prisma.bankAccount.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' }, include: { organization: { select: { nameTh: true } } } }),
      this.prisma.incomeCode.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
    ]);
    return {
      bankAccounts: bankAccounts.map((b) => ({ id: b.id, label: `${b.bankName} ${b.accountNo} (${b.accountName})`, organizationName: b.organization?.nameTh ?? 'ส่วนกลาง', hasPromptPay: !!b.promptPayId })),
      incomeCodes: incomeCodes.map((c) => ({ id: c.id, code: c.code, label: `${c.code} ${c.nameTh}` })),
    };
  }

  @RequirePermissions('bank_account:view')
  @Get('bank-accounts')
  bankAccounts() {
    return this.prisma.bankAccount.findMany({ orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }], include: { organization: { select: { id: true, nameTh: true } } } });
  }

  @RequirePermissions('bank_account:create')
  @Post('bank-accounts')
  async createBank(@Body() dto: BankAccountDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    const row = await this.prisma.bankAccount.create({ data: { ...dto, organizationId: dto.organizationId ?? null, isActive: dto.isActive ?? true } });
    await this.audit.log({ actorId: u.id, action: 'bank_account.create', entityType: 'bank_account', entityId: row.id, after: dto, meta: m });
    return row;
  }

  /** Existing payment orders keep their own snapshot, so edits never change issued invoices. */
  @RequirePermissions('bank_account:update')
  @Patch('bank-accounts/:id')
  async updateBank(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BankAccountDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    const before = await this.prisma.bankAccount.findUnique({ where: { id } });
    if (!before) throw Errors.notFound('บัญชีรับเงิน');
    const row = await this.prisma.bankAccount.update({ where: { id }, data: { ...dto, organizationId: dto.organizationId ?? null } });
    await this.audit.log({ actorId: u.id, action: 'bank_account.update', entityType: 'bank_account', entityId: id, before, after: dto, meta: m });
    return row;
  }

  @RequirePermissions('income_code:view')
  @Get('income-codes')
  incomeCodes() {
    return this.prisma.incomeCode.findMany({ orderBy: [{ isActive: 'desc' }, { code: 'asc' }] });
  }

  @RequirePermissions('income_code:create')
  @Post('income-codes')
  async createIncome(@Body() dto: IncomeCodeDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    if (await this.prisma.incomeCode.findUnique({ where: { code: dto.code } })) throw Errors.conflict('DUPLICATE_CODE', 'รหัสรายได้นี้มีอยู่แล้ว');
    const row = await this.prisma.incomeCode.create({ data: { ...dto, isActive: dto.isActive ?? true } });
    await this.audit.log({ actorId: u.id, action: 'income_code.create', entityType: 'income_code', entityId: row.id, after: dto, meta: m });
    return row;
  }

  @RequirePermissions('income_code:update')
  @Patch('income-codes/:id')
  async updateIncome(@Param('id', ParseUUIDPipe) id: string, @Body() dto: IncomeCodeDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    const before = await this.prisma.incomeCode.findUnique({ where: { id } });
    if (!before) throw Errors.notFound('รหัสรายได้');
    const row = await this.prisma.incomeCode.update({ where: { id }, data: dto });
    await this.audit.log({ actorId: u.id, action: 'income_code.update', entityType: 'income_code', entityId: id, before, after: dto, meta: m });
    return row;
  }
}
