import { toSatang } from './money';

const DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const POSITIONS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

/**
 * Read an integer of up to 6 digits (one "ล้าน" group).
 * `hasHigher` tells whether any non-zero digit exists to the left of this
 * group, which makes a trailing 1 read as "เอ็ด" (e.g. 1,000,001 → หนึ่งล้านเอ็ด).
 */
function readGroup(n: number, hasHigher: boolean): string {
  if (n === 0) return '';
  const s = String(n);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const d = Number(s[i]);
    const pos = s.length - i - 1;
    if (d === 0) continue;
    if (pos === 1 && d === 1) out += 'สิบ';
    else if (pos === 1 && d === 2) out += 'ยี่สิบ';
    else if (pos === 0 && d === 1 && (n > 1 || hasHigher)) out += 'เอ็ด';
    else out += DIGITS[d]! + POSITIONS[pos]!;
  }
  return out;
}

function readInteger(n: bigint): string {
  if (n === 0n) return '';
  const groups: number[] = [];
  let rest = n;
  while (rest > 0n) {
    groups.unshift(Number(rest % 1_000_000n));
    rest /= 1_000_000n;
  }
  let out = '';
  groups.forEach((g, idx) => {
    const isLast = idx === groups.length - 1;
    out += readGroup(g, out.length > 0);
    if (!isLast) out += 'ล้าน';
  });
  return out;
}

/**
 * Convert an amount to Thai text, e.g. "1500.00" → "หนึ่งพันห้าร้อยบาทถ้วน",
 * "21.25" → "ยี่สิบเอ็ดบาทยี่สิบห้าสตางค์".
 */
export function bahtText(value: string | number): string {
  let satang = toSatang(value);
  const negative = satang < 0n;
  if (negative) satang = -satang;

  const baht = satang / 100n;
  const st = satang % 100n;

  let out: string;
  if (baht === 0n && st === 0n) out = 'ศูนย์บาทถ้วน';
  else {
    out = baht > 0n ? `${readInteger(baht)}บาท` : '';
    out += st === 0n ? 'ถ้วน' : `${readGroup(Number(st), false)}สตางค์`;
  }
  return negative ? `ลบ${out}` : out;
}
