/**
 * Dates are stored as UTC timestamptz. Everything user-facing is rendered in
 * Asia/Bangkok with the Buddhist Era year. The BE offset is applied exactly
 * once, here, at presentation time — never in the API layer (spec §7).
 */

export const BANGKOK_TZ = 'Asia/Bangkok';
export const BE_OFFSET = 543;

function bangkokParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/**
 * Thai government fiscal year (1 Oct – 30 Sep), in BE.
 * 2026-10-01 (Bangkok) → 2570; 2026-09-30 → 2569.
 */
export function fiscalYearBE(date: Date = new Date()): number {
  const { year, month } = bangkokParts(date);
  return (month >= 10 ? year + 1 : year) + BE_OFFSET;
}

/** Inclusive start / exclusive end of a BE fiscal year, as UTC instants. */
export function fiscalYearRange(fyBE: number): { start: Date; end: Date } {
  const ce = fyBE - BE_OFFSET;
  // 00:00 Bangkok = 17:00 UTC on the previous day.
  return {
    start: new Date(Date.UTC(ce - 1, 9, 1) - 7 * 3600_000),
    end: new Date(Date.UTC(ce, 9, 1) - 7 * 3600_000),
  };
}

const thaiFmt = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { timeZone: BANGKOK_TZ, ...opts });

/** "5 พ.ย. 2569" */
export function formatThaiDate(date: Date | string, style: 'short' | 'long' = 'short'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return thaiFmt({ day: 'numeric', month: style, year: 'numeric' }).format(d);
}

/** "5 พ.ย. 2569 14:30 น." */
export function formatThaiDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: BANGKOK_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return `${formatThaiDate(d)} ${time} น.`;
}

/** Collator for Thai dictionary ordering (name sorting for badges / reports). */
export const thaiCollator = new Intl.Collator('th', { sensitivity: 'base' });
