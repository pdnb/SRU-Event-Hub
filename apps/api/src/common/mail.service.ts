import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../config/env';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Outgoing e-mail. With SMTP_URL set, mail goes through that relay (the university SMTP – GRP-5).
 * Without it (development / test) the message is only logged, and kept in memory for e2e tests.
 * Delivery problems never fail the business request: they are logged and the user can ask again.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter | null;
  private readonly from: string;
  /** Last messages sent while no SMTP relay is configured (dev/test only). */
  readonly outbox: OutgoingMail[] = [];

  constructor(config: ConfigService<Env, true>) {
    const url = config.get('SMTP_URL', { infer: true })?.trim();
    this.transport = url ? createTransport(url) : null;
    this.from = config.get('MAIL_FROM', { infer: true })?.trim() || 'SRU Event Hub <no-reply@localhost>';
  }

  get enabled() {
    return this.transport !== null;
  }

  async send(mail: OutgoingMail): Promise<boolean> {
    if (!this.transport) {
      this.outbox.push(mail);
      if (this.outbox.length > 50) this.outbox.shift();
      this.logger.warn({ to: mail.to, subject: mail.subject, text: mail.text }, 'SMTP_URL not set – e-mail not sent (logged only)');
      return false;
    }
    try {
      await this.transport.sendMail({ from: this.from, to: mail.to, subject: mail.subject, text: mail.text });
      return true;
    } catch (e) {
      this.logger.error({ to: mail.to, subject: mail.subject, err: String(e) }, 'E-mail delivery failed');
      return false;
    }
  }
}
