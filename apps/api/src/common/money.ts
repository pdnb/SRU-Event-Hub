import { normalizeMoney } from '@sru/shared-utils';
import { Prisma } from '../generated/prisma/client';

/** Prisma Decimal → wire string "1500.00" (never a JS number). */
export function moneyOut(value: Prisma.Decimal | null | undefined): string | null {
  return value == null ? null : normalizeMoney(value.toFixed(2));
}

/** Wire string → Prisma Decimal, validated to 2 decimals. */
export function moneyIn(value: string | null | undefined): Prisma.Decimal | null {
  return value == null || value === '' ? null : new Prisma.Decimal(normalizeMoney(value));
}
