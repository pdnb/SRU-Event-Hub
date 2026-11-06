import { randomBytes } from 'node:crypto';

/**
 * RFC 9562 UUID v7 (time-ordered), matching the database default `uuid(7)`. Used where the id must be
 * known before the INSERT (e.g. a check-in token whose secret is derived from its own id).
 */
export function uuidv7(now = Date.now()): string {
  const b = randomBytes(16);
  b.writeUIntBE(now, 0, 6);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
