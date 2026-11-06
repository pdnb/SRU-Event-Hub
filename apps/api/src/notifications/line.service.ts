import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env';

/**
 * LINE Messaging API (official account). Push text messages to linked users and verify webhook
 * signatures (base64 HMAC-SHA256 of the raw body with the channel secret). Without credentials the
 * channel is off: nothing is queued for LINE and the webhook answers 404.
 */
@Injectable()
export class LineService {
  private readonly logger = new Logger(LineService.name);
  private readonly token?: string;
  private readonly secret?: string;
  readonly botId?: string;
  /** Messages "sent" while no token is configured (tests). */
  readonly outbox: { to: string; text: string }[] = [];

  constructor(config: ConfigService<Env, true>) {
    this.token = config.get('LINE_CHANNEL_ACCESS_TOKEN', { infer: true })?.trim() || undefined;
    this.secret = config.get('LINE_CHANNEL_SECRET', { infer: true })?.trim() || undefined;
    this.botId = config.get('LINE_BOT_ID', { infer: true })?.trim() || undefined;
  }

  /** Accepting webhooks needs the secret; pushing needs the token. */
  get webhookEnabled() {
    return !!this.secret;
  }

  get pushEnabled() {
    return !!this.token || process.env.NODE_ENV === 'test';
  }

  verifySignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
    if (!this.secret || !rawBody || !signature) return false;
    const expected = createHmac('sha256', this.secret).update(rawBody).digest();
    const given = Buffer.from(signature, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  /** Throws on failure so the delivery worker can retry. LINE text limit is 5000 characters. */
  async push(to: string, text: string): Promise<void> {
    const body = text.slice(0, 4900);
    if (!this.token) {
      this.outbox.push({ to, text: body });
      if (this.outbox.length > 50) this.outbox.shift();
      return;
    }
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ to, messages: [{ type: 'text', text: body }] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      this.logger.warn({ status: res.status, detail }, 'LINE push failed');
      throw new Error(`LINE ${res.status}: ${detail}`);
    }
  }

  /** Best-effort reply to a webhook event (link confirmation). */
  async reply(replyToken: string, text: string): Promise<void> {
    if (!this.token) {
      this.outbox.push({ to: `reply:${replyToken}`, text });
      return;
    }
    await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
      signal: AbortSignal.timeout(10_000),
    }).catch((e) => this.logger.warn({ err: String(e) }, 'LINE reply failed'));
  }
}
