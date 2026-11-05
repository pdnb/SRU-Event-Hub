import { normalizeMoney, toSatang } from './money';

/**
 * PromptPay (Thai QR Payment, EMVCo MPM) payload generator.
 *
 * Supports the three PromptPay proxy types:
 *  - mobile number (10 digits, 0xxxxxxxxx)
 *  - national ID / tax ID (13 digits)
 *  - e-wallet ID (15 digits)
 *
 * An amount makes the QR "dynamic" (point of initiation = 12).
 */

const AID_PROMPTPAY = 'A000000677010111';

export type PromptPayTarget = { kind: 'mobile' | 'taxId' | 'eWallet'; value: string };

function tlv(id: string, value: string): string {
  return id + value.length.toString().padStart(2, '0') + value;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), as required by EMVCo tag 63. */
export function crc16ccitt(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Detect the proxy type from a raw identifier (digits; separators are ignored). */
export function detectPromptPayTarget(raw: string): PromptPayTarget {
  const value = raw.replace(/\D/g, '');
  if (value.length === 10 && value.startsWith('0')) return { kind: 'mobile', value };
  if (value.length === 13) return { kind: 'taxId', value };
  if (value.length === 15) return { kind: 'eWallet', value };
  throw new Error('Unsupported PromptPay identifier');
}

function proxyTag(target: PromptPayTarget): string {
  switch (target.kind) {
    case 'mobile':
      // 0812345678 → 0066812345678 (country code 66, zero-padded to 13)
      return tlv('01', ('66' + target.value.slice(1)).padStart(13, '0'));
    case 'taxId':
      return tlv('02', target.value);
    case 'eWallet':
      return tlv('03', target.value);
  }
}

export function promptPayPayload(target: string | PromptPayTarget, amount?: string): string {
  const t = typeof target === 'string' ? detectPromptPayTarget(target) : target;
  const hasAmount = amount !== undefined && toSatang(amount) > 0n;
  if (amount !== undefined && toSatang(amount) < 0n) throw new Error('Amount must be positive');

  const merchant = tlv('00', AID_PROMPTPAY) + proxyTag(t);
  let payload =
    tlv('00', '01') +
    tlv('01', hasAmount ? '12' : '11') +
    tlv('29', merchant) +
    tlv('58', 'TH') +
    tlv('53', '764');
  if (hasAmount) payload += tlv('54', normalizeMoney(amount!));
  payload += '6304';
  return payload + crc16ccitt(payload);
}
