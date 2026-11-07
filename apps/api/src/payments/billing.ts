import { formatBranch, formatThaiTaxId, isValidThaiTaxId, normalizeTaxId } from '@sru/shared-utils';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Errors } from '../common/errors';
import type { BillingInfoDto } from '@sru/shared-types';
import type { BillingType } from '../generated/prisma/client';

/**
 * FIN-9: who the official receipt (issued by กองคลัง) is made out to. Collected with the
 * registration or later from the payer's status page, and printed on the remittance report so
 * กองคลัง can issue the receipt in the right name. FIN-9 (answered 2026-11-07): no tax is computed —
 * the system only records and validates the payer's name, tax id, branch and address.
 */
export class BillingInputDto {
  @IsIn(['INDIVIDUAL', 'JURISTIC']) type!: BillingType;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(300) name?: string;
  @IsOptional() @IsString() @MaxLength(20) taxId?: string;
  /** "00000" = สำนักงานใหญ่, otherwise a 5-digit branch number. */
  @IsOptional() @IsString() @MaxLength(100) branch?: string;
  @IsOptional() @IsString() @MaxLength(1000) address?: string;
}

export type BillingDto = BillingInfoDto;

/** Validated columns for payment_orders. INDIVIDUAL clears the juristic fields. */
export function billingColumns(b: BillingInputDto) {
  if (b.type === 'INDIVIDUAL') {
    return { billingType: 'INDIVIDUAL' as const, billingName: null, billingTaxId: null, billingBranch: null, billingAddress: b.address?.trim() || null };
  }
  const name = b.name?.trim();
  if (!name) throw Errors.validation('กรุณาระบุชื่อนิติบุคคล/หน่วยงานที่ออกใบเสร็จ');
  const taxId = normalizeTaxId(b.taxId ?? '');
  if (!isValidThaiTaxId(taxId)) throw Errors.validation('เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง (13 หลัก)');
  const branch = (b.branch ?? '').trim() || '00000';
  if (!/^\d{5}$/.test(branch) && branch !== 'สำนักงานใหญ่') throw Errors.validation('สาขาต้องเป็นเลข 5 หลัก (00000 = สำนักงานใหญ่)');
  const address = b.address?.trim();
  if (!address) throw Errors.validation('กรุณาระบุที่อยู่สำหรับออกใบเสร็จ');
  return { billingType: 'JURISTIC' as const, billingName: name, billingTaxId: taxId, billingBranch: branch === 'สำนักงานใหญ่' ? '00000' : branch, billingAddress: address };
}

export function billingDto(o: { billingType: BillingType; billingName: string | null; billingTaxId: string | null; billingBranch: string | null; billingAddress: string | null }): BillingDto {
  return { type: o.billingType, name: o.billingName, taxId: o.billingTaxId, branch: o.billingBranch, address: o.billingAddress };
}

/** One-line text for reports: empty for individuals (the payer's own name is used). */
export function billingText(b: BillingDto | null | undefined): string {
  if (!b || b.type !== 'JURISTIC') return '';
  return `${b.name} (เลขผู้เสียภาษี ${formatThaiTaxId(b.taxId ?? '')} ${formatBranch(b.branch)})`;
}
