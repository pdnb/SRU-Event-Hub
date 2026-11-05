import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../common/pagination';
import { FinanceBatchStatus, PaymentChannel, PaymentStatus } from '../generated/prisma/client';

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

export class EligibleQueryDto {
  @IsUUID() eventId!: string;
}

export class ReceiptInputDto {
  @IsUUID() paymentId!: string;
  @IsString() @Matches(/^[\w\-/.]{1,20}$/, { message: 'เล่มที่ไม่ถูกต้อง' }) bookNo!: string;
  @IsString() @Matches(/^[\w\-/.]{1,30}$/, { message: 'เลขที่ไม่ถูกต้อง' }) receiptNo!: string;
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
  @IsString() @Matches(/^[\w.\-]{1,30}$/) code!: string;
  @IsString() @MinLength(2) @MaxLength(300) nameTh!: string;
  @IsOptional() isActive?: boolean;
}
