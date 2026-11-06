import { createHash, createHmac, hkdfSync } from 'node:crypto';

/**
 * Check-in QR credentials (spec §4.8).
 *
 * The QR text is `SRU1.<token>` where token = HMAC-SHA256(key, "ck:" + checkin_tokens.id), truncated
 * to 128 bits and base64url encoded. Consequences:
 *  - the database stores only sha256(token) → a DB reader cannot forge a QR;
 *  - the server can show the same QR again at any time (my registrations, status lookup, reprint);
 *  - a scanner device can verify a QR offline against the hashes in its roster pack;
 *  - revoking = a new row (new id → new token); the old printed QR stops working.
 *
 * The key is derived from FIELD_ENCRYPTION_KEY with HKDF (separate purpose label), so no new secret
 * has to be provisioned and rotating the JWT secret never invalidates printed badges.
 */

export const QR_PREFIX = 'SRU1.';
const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

export function deriveCheckinKey(fieldEncryptionKeyB64: string): Buffer {
  const ikm = Buffer.from(fieldEncryptionKeyB64, 'base64');
  return Buffer.from(hkdfSync('sha256', ikm, Buffer.alloc(0), 'sru-event-hub/checkin-qr/v1', 32));
}

export function tokenFor(key: Buffer, tokenId: string): string {
  return createHmac('sha256', key).update(`ck:${tokenId}`).digest().subarray(0, 16).toString('base64url');
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const qrText = (token: string) => `${QR_PREFIX}${token}`;

/**
 * Accepts what a scanner hands over: the QR text, the bare token (hand-typed), with stray whitespace
 * or a keyboard-wedge newline. Returns null for anything that is not a check-in credential.
 */
export function parseQr(raw: string): string | null {
  const s = raw.trim();
  const token = s.toUpperCase().startsWith(QR_PREFIX.toUpperCase()) ? s.slice(QR_PREFIX.length) : s;
  return TOKEN_RE.test(token) ? token : null;
}
