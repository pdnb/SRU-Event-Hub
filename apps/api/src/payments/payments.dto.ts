import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../common/pagination';
import { CashierSessionStatus, FinanceBatchStatus, PaymentChannel, PaymentStatus, RefundStatus } from '../generated/prisma/client';

/** Multipart text fields that accompany a slip upload. */
export class SubmitSlipDto {
  @IsOptional() @IsDateString() transferredAt?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/** Guest slip upload: the registration's secret token authorises the request. */
export class TokenSlipDto extends SubmitSlipDto {
  @IsString() @Matches(/^REG-\d{4}-\d{6}$/) referenceNo!: string;
  @IsString() @MinLength(20) @MaxLength(100) token!: string;
}

export class RejectDto {
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}

export class FinancePaymentQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: PaymentStatus }) @IsOptional() @IsEnum(PaymentStatus) status?: PaymentStatus;
  @ApiPropertyOptional({ enum: PaymentChannel }) @IsOptional() @IsEnum(PaymentChannel) channel?: PaymentChannel;
  @IsOptional() @IsUUID() eventId?: string;
}

// ───────────── Finance batches ─────────────

export class CreateBatchDto {
  @IsUUID() eventId!: string;
  /** Specific verified payments; omitted = every eligible verified payment of the event. */
  @IsOptional() @IsArray() @ArrayMaxSize(2000) @IsUUID('all', { each: true }) paymentIds?: string[];
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class BatchQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: FinanceBatchStatus }) @IsOptional() @IsEnum(FinanceBatchStatus) status?: FinanceBatchStatus;
  @IsOptional() @IsUUID() eventId?: string;
}

export class ExportFormatDto {
  @IsOptional() @IsIn(['pdf', 'xlsx']) format: 'pdf' | 'xlsx' = 'xlsx';
}

export class EligibleQueryDto {
  @IsUUID() eventId!: string;
}

export class ReceiptInputDto {
  @IsUUID() paymentId!: string;
  /** Running number only (FIN-2: 2569/0001 → "1" or "0001"); the fiscal year comes from issuedAt. */
  @IsString() @Matches(/^0*[1-9]\d{0,9}$/, { message: 'เลขที่ใบเสร็จต้องเป็นตัวเลข เช่น 0001' }) receiptNo!: string;
  @IsDateString() issuedAt!: string;
}

export class RecordReceiptsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => ReceiptInputDto)
  receipts!: ReceiptInputDto[];
}

// ───────────── Settings ─────────────

export class BankAccountDto {
  @IsOptional() @IsUUID() organizationId?: string | null;
  @IsString() @MinLength(2) @MaxLength(150) bankName!: string;
  @IsOptional() @IsString() @MaxLength(150) branch?: string | null;
  @IsString() @Matches(/^[\d-]{6,20}$/, { message: 'เลขที่บัญชีไม่ถูกต้อง' }) accountNo!: string;
  @IsString() @MinLength(2) @MaxLength(300) accountName!: string;
  /** 13-digit tax id / citizen id, 15-digit e-wallet, or 10-digit phone. */
  @IsOptional() @IsString() @Matches(/^(\d{10}|\d{13}|\d{15})$/, { message: 'รหัสพร้อมเพย์ไม่ถูกต้อง' }) promptPayId?: string | null;
  @IsOptional() isActive?: boolean;
}

export class IncomeCodeDto {
  @IsString() @Matches(/^[\w.-]{1,30}$/) code!: string;
  @IsString() @MinLength(2) @MaxLength(300) nameTh!: string;
  @IsOptional() isActive?: boolean;
}

// ───────────── Cashier (on-site) ─────────────

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

export class OpenSessionDto {
  @IsUUID() eventId!: string;
  /** เงินทอนตั้งต้น (not counted as revenue). */
  @IsOptional() @Matches(MONEY, { message: 'จำนวนเงินไม่ถูกต้อง' }) openingFloat?: string;
}

export class CashierQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: CashierSessionStatus }) @IsOptional() @IsEnum(CashierSessionStatus) status?: CashierSessionStatus;
  @IsOptional() @IsUUID() eventId?: string;
}

export class PayablesQueryDto {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
}

export class CollectDto {
  @IsUUID() orderId!: string;
  /** FIN-12: only when syncing a collection recorded offline — when the cash was actually taken. */
  @IsOptional() @IsDateString() capturedAt?: string;
}

export class CloseSessionDto {
  /** Cash counted in the drawer for this session, excluding the opening float. */
  @Matches(MONEY, { message: 'จำนวนเงินไม่ถูกต้อง' }) countedAmount!: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class RemitDto {
  @IsString() @Matches(/^[\w\-/.]{1,50}$/, { message: 'เลขที่ใบนำส่งไม่ถูกต้อง' }) remittanceNo!: string;
}

// ───────────── Refunds ─────────────

export class CreateRefundDto {
  @IsUUID() orderId!: string;
  @Matches(MONEY, { message: 'จำนวนเงินไม่ถูกต้อง' }) amount!: string;
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
  @IsString() @MinLength(2) @MaxLength(300) payeeName!: string;
  @IsString() @MinLength(2) @MaxLength(150) bankName!: string;
  @IsString() @Matches(/^[\d-]{6,20}$/, { message: 'เลขที่บัญชีไม่ถูกต้อง' }) accountNo!: string;
}

export class PayRefundDto {
  @IsString() @MinLength(3) @MaxLength(100) paidRef!: string;
}

export class RefundQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: RefundStatus }) @IsOptional() @IsEnum(RefundStatus) status?: RefundStatus;
}

export class RefundableQueryDto {
  @IsOptional() @IsUUID() eventId?: string;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
}
