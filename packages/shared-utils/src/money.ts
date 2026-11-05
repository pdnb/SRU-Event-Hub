/**
 * Money helpers. All arithmetic is done on integer satang (BigInt) so we never
 * touch floating point. On the wire, amounts are decimal strings with exactly
 * two fraction digits, e.g. "1500.00" (spec §8).
 */

const MONEY_RE = /^(-)?(\d{1,10})(?:\.(\d{1,2}))?$/;

export class InvalidMoneyError extends Error {
  constructor(value: unknown) {
    super(`Invalid money value: ${String(value)}`);
    this.name = 'InvalidMoneyError';
  }
}

/** Parse "1500", "1500.5", "1500.50" into satang. Rejects more than 2 decimals. */
export function toSatang(value: string | number | bigint): bigint {
  if (typeof value === 'bigint') return value * 100n;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new InvalidMoneyError(value);
    // Numbers are accepted only for convenience in code; round-trip via fixed string.
    value = value.toFixed(2);
  }
  const m = MONEY_RE.exec(value.trim());
  if (!m) throw new InvalidMoneyError(value);
  const [, neg, int, frac = ''] = m;
  const satang = BigInt(int!) * 100n + BigInt(frac.padEnd(2, '0'));
  return neg ? -satang : satang;
}

/** Satang → canonical wire format "1500.00". */
export function fromSatang(satang: bigint): string {
  const neg = satang < 0n;
  const abs = neg ? -satang : satang;
  const int = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${neg ? '-' : ''}${int.toString()}.${frac}`;
}

/** Normalise any accepted input to the canonical wire string. */
export function normalizeMoney(value: string | number): string {
  return fromSatang(toSatang(value));
}

export function addMoney(...values: string[]): string {
  return fromSatang(values.reduce((acc, v) => acc + toSatang(v), 0n));
}

export function subtractMoney(a: string, b: string): string {
  return fromSatang(toSatang(a) - toSatang(b));
}

/** unit price × quantity (quantity must be a non-negative integer). */
export function multiplyMoney(unit: string, quantity: number): string {
  if (!Number.isInteger(quantity) || quantity < 0) throw new InvalidMoneyError(quantity);
  return fromSatang(toSatang(unit) * BigInt(quantity));
}

export function compareMoney(a: string, b: string): -1 | 0 | 1 {
  const d = toSatang(a) - toSatang(b);
  return d === 0n ? 0 : d < 0n ? -1 : 1;
}

/** Display format "1,234.00" (no currency suffix; add " บาท" in UI). */
export function formatMoney(value: string): string {
  const [int, frac] = normalizeMoney(value).split('.');
  const neg = int!.startsWith('-');
  const digits = neg ? int!.slice(1) : int!;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}.${frac}`;
}
