import { randomBytes } from 'node:crypto';
import { FieldCryptoService } from './field-crypto.service';

const make = (key = randomBytes(32).toString('base64')) =>
  new FieldCryptoService({ get: () => key } as never);

describe('FieldCryptoService', () => {
  it('round-trips and uses a fresh IV every time', () => {
    const c = make();
    const a = c.encrypt('123-4-56789-0');
    const b = c.encrypt('123-4-56789-0');
    expect(a).not.toBe(b);
    expect(a).not.toContain('56789');
    expect(c.decrypt(a)).toBe('123-4-56789-0');
  });

  it('detects tampering (GCM auth tag)', () => {
    const c = make();
    const parts = c.encrypt('1234567890').split('.');
    parts[3] = Buffer.from('tampered!!').toString('base64url');
    expect(() => c.decrypt(parts.join('.'))).toThrow();
  });

  it('cannot decrypt with another key', () => {
    expect(() => make().decrypt(make().encrypt('1234567890'))).toThrow();
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => make(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });

  it('masks all but the last 4 digits', () => {
    expect(FieldCryptoService.mask('123-4-56789-0')).toBe('••••••7890');
  });
});
