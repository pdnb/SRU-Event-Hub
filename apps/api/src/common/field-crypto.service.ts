import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Env } from '../config/env';

const VERSION = 'v1';

/**
 * Field-level encryption for sensitive values at rest (refund bank account numbers).
 * AES-256-GCM with a random 96-bit IV per value; output `v1.<iv>.<tag>.<ciphertext>` (base64url).
 * The key comes only from FIELD_ENCRYPTION_KEY (32 bytes, base64) and is never stored in the DB.
 */
@Injectable()
export class FieldCryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService<Env, true>) {
    this.key = Buffer.from(String(config.get('FIELD_ENCRYPTION_KEY', { infer: true })), 'base64');
    if (this.key.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
  }

  decrypt(token: string): string {
    const [v, iv, tag, ct] = token.split('.');
    if (v !== VERSION || !iv || !tag || !ct) throw new Error('Unsupported ciphertext format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
  }

  /** "123-4-56789-0" → "••••••7890": only the last 4 digits are kept. */
  static mask(accountNo: string): string {
    const digits = accountNo.replace(/\D/g, '');
    return `${'•'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
  }
}
