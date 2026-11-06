import { randomBytes } from 'node:crypto';
import { deriveCheckinKey, hashToken, parseQr, qrText, tokenFor } from './checkin-token';

describe('check-in QR token', () => {
  const key = deriveCheckinKey(randomBytes(32).toString('base64'));

  it('is deterministic per token row and differs between rows and keys', () => {
    const a = tokenFor(key, '0190f0e0-0000-7000-8000-000000000001');
    expect(tokenFor(key, '0190f0e0-0000-7000-8000-000000000001')).toBe(a);
    expect(tokenFor(key, '0190f0e0-0000-7000-8000-000000000002')).not.toBe(a);
    expect(tokenFor(deriveCheckinKey(randomBytes(32).toString('base64')), '0190f0e0-0000-7000-8000-000000000001')).not.toBe(a);
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('parses scanner input: prefix, bare token, whitespace / newline from keyboard wedges', () => {
    const t = tokenFor(key, 'x');
    expect(parseQr(qrText(t))).toBe(t);
    expect(parseQr(`  ${qrText(t)}\r\n`)).toBe(t);
    expect(parseQr(`sru1.${t}`)).toBe(t);
    expect(parseQr(t)).toBe(t);
    expect(parseQr('https://example.com')).toBeNull();
    expect(parseQr('SRU1.short')).toBeNull();
    expect(parseQr('')).toBeNull();
  });
});
