import { createHmac, hkdfSync } from 'node:crypto';

/**
 * Purpose-bound keys derived from FIELD_ENCRYPTION_KEY with HKDF, so features that need a keyed hash
 * (evaluation respondent keys, verification-log IP hashes …) do not need their own secret and can
 * never collide with each other's outputs.
 */
export function deriveKey(fieldEncryptionKeyB64: string, label: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(fieldEncryptionKeyB64, 'base64'), Buffer.alloc(0), `sru-event-hub/${label}`, 32));
}

export const hmacHex = (key: Buffer, data: string) => createHmac('sha256', key).update(data).digest('hex');
