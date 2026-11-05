import { crc16ccitt, detectPromptPayTarget, promptPayPayload } from '../src/promptpay';

/** Parse a TLV string into {id: value}, recursing is left to callers. */
function parseTlv(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < s.length) {
    const id = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    out[id] = s.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

describe('crc16ccitt', () => {
  it('matches the CRC-16/CCITT-FALSE check value', () => {
    expect(crc16ccitt('123456789')).toBe('29B1');
  });
});

describe('promptPayPayload', () => {
  // Vectors cross-checked byte-for-byte against the `promptpay-qr` reference library.
  it.each([
    ['081-234-5678', undefined, '00020101021129370016A000000677010111011300668123456785802TH530376463045D82'],
    ['0812345678', '1500', '00020101021229370016A000000677010111011300668123456785802TH530376454071500.0063046960'],
    ['0994000165676', '10.50', '00020101021229370016A000000677010111021309940001656765802TH5303764540510.5063043434'],
  ])('matches reference payload for %s amount=%s', (id, amount, expected) => {
    expect(promptPayPayload(id, amount)).toBe(expected);
  });

  it('produces a dynamic payload with amount and valid CRC', () => {
    const payload = promptPayPayload('0812345678', '1500');
    const tags = parseTlv(payload);
    expect(tags['01']).toBe('12');
    expect(tags['54']).toBe('1500.00');
    expect(tags['53']).toBe('764');
    expect(tags['58']).toBe('TH');
    const body = payload.slice(0, -4);
    expect(payload.slice(-4)).toBe(crc16ccitt(body));
  });

  it('encodes a 13-digit tax ID under sub-tag 02', () => {
    const tags = parseTlv(promptPayPayload('0994000165676', '10.50'));
    const merchant = parseTlv(tags['29']!);
    expect(merchant['00']).toBe('A000000677010111');
    expect(merchant['02']).toBe('0994000165676');
  });

  it('treats zero amount as static', () => {
    expect(parseTlv(promptPayPayload('0812345678', '0'))['01']).toBe('11');
  });

  it('rejects unsupported identifiers', () => {
    expect(() => detectPromptPayTarget('12345')).toThrow();
    expect(() => promptPayPayload('0812345678', '-1')).toThrow();
  });
});
