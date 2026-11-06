import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt } from 'node:crypto';
import type { AuthUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import type { RequestMeta } from '../common/decorators';
import { AppError, Errors } from '../common/errors';
import { MailService } from '../common/mail.service';
import { Paginated, PageQueryDto } from '../common/pagination';
import type { Env } from '../config/env';
import { NotificationChannel, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LineService } from './line.service';
import { DEFAULT_TEMPLATES, renderText, TemplateText } from './templates';

export interface Recipient {
  userId?: string | null;
  /** E-mail to use (guests have no account). Defaults to the user's account e-mail. */
  email?: string | null;
  name?: string | null;
}

export interface NotifyInput {
  code: keyof typeof DEFAULT_TEMPLATES | string;
  recipients: Recipient[];
  vars: Record<string, string | number | null | undefined>;
  /** Path inside the web app, e.g. /my/registrations. */
  link?: string | null;
  /** Stable id of the fact (e.g. "audit:<id>") — the same fact is never delivered twice. */
  dedupe: string;
}

const MAX_ATTEMPTS = 5;
const LEASE_MS = 5 * 60_000;
const backoffMs = (attempt: number) => Math.min(6 * 3600_000, 60_000 * 2 ** (attempt - 1)); // 1, 2, 4, 8 min …

/**
 * Notifications (spec §4.12): in-app inbox + outbox for e-mail and LINE.
 *
 * `notify()` renders the template once per recipient and writes rows with unique dedupe keys, so
 * re-running the same fact (several API replicas, a retried job) delivers nothing twice. Delivery
 * claims due rows with a lease (UPDATE … WHERE status = QUEUED AND next_attempt_at <= now), sends,
 * and either marks SENT or schedules a retry with exponential back-off; after 5 attempts FAILED.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly webUrl: string;
  private overrides: { at: number; map: Map<string, { subject: string | null; body: string }> } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly line: LineService,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
  ) {
    this.webUrl = String(config.get('WEB_PUBLIC_URL', { infer: true })).replace(/\/$/, '');
  }

  // ───────────── fan-out ─────────────

  async notify(input: NotifyInput): Promise<number> {
    const tpl = await this.template(input.code);
    const userIds = [...new Set(input.recipients.map((r) => r.userId).filter((x): x is string => !!x))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds }, deletedAt: null, status: 'ACTIVE' },
          select: { id: true, email: true, displayName: true, notificationPref: true, lineAccount: { select: { lineUserId: true } } },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    const link = input.link ? `${this.webUrl}${input.link}` : null;

    const inApp: Prisma.NotificationCreateManyInput[] = [];
    const outbox: Prisma.NotificationLogCreateManyInput[] = [];
    const seen = new Set<string>();
    for (const r of input.recipients) {
      const u = r.userId ? byId.get(r.userId) : undefined;
      if (r.userId && !u) continue; // suspended / deleted account
      const vars = { ...input.vars, name: r.name ?? u?.displayName ?? '', link: link ?? '' };
      const title = renderText(tpl.in.subject ?? tpl.base.title, vars).slice(0, 300);
      const body = renderText(tpl.in.body, vars).slice(0, 2000);
      if (u && !seen.has(`u:${u.id}`)) {
        seen.add(`u:${u.id}`);
        inApp.push({ userId: u.id, type: input.code, title, body, link: input.link ?? null, dedupeKey: `${input.dedupe}:${u.id}`.slice(0, 200) });
      }
      const email = (r.email ?? u?.email ?? '').trim().toLowerCase();
      if (email && u?.notificationPref?.email !== false && !seen.has(`e:${email}`)) {
        seen.add(`e:${email}`);
        outbox.push({
          channel: 'EMAIL', templateCode: input.code, recipient: email, userId: u?.id ?? null,
          subject: renderText(tpl.email.subject ?? tpl.base.emailSubject ?? tpl.base.title, vars).slice(0, 300),
          body: `${renderText(tpl.email.body, vars)}${link ? `\n\n${link}` : ''}\n\n— SRU Event Hub (อีเมลอัตโนมัติ กรุณาอย่าตอบกลับ)`,
          dedupeKey: `${input.dedupe}:email:${email}`.slice(0, 200),
        });
      }
      const lineId = u?.lineAccount?.lineUserId;
      if (lineId && u?.notificationPref?.line !== false && this.line.pushEnabled && !seen.has(`l:${lineId}`)) {
        seen.add(`l:${lineId}`);
        outbox.push({
          channel: 'LINE', templateCode: input.code, recipient: lineId, userId: u!.id,
          body: `${title}\n${renderText(tpl.line.body, vars)}${link ? `\n${link}` : ''}`,
          dedupeKey: `${input.dedupe}:line:${lineId}`.slice(0, 200),
        });
      }
    }
    if (inApp.length) await this.prisma.notification.createMany({ data: inApp, skipDuplicates: true });
    if (outbox.length) await this.prisma.notificationLog.createMany({ data: outbox, skipDuplicates: true });
    return inApp.length + outbox.length;
  }

  // ───────────── delivery ─────────────

  /** Delivers due outbox rows. Safe to run concurrently (rows are leased). */
  async deliverDue(limit = 50): Promise<{ sent: number; failed: number }> {
    const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE notification_logs SET attempts = attempts + 1, next_attempt_at = now() + ${`${LEASE_MS} milliseconds`}::interval
      WHERE id IN (
        SELECT id FROM notification_logs
        WHERE status = 'QUEUED' AND next_attempt_at <= now()
        ORDER BY next_attempt_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id::text AS id`;
    let sent = 0;
    let failed = 0;
    for (const { id } of claimed) {
      const n = await this.prisma.notificationLog.findUniqueOrThrow({ where: { id } });
      try {
        let note: string | null = null;
        if (n.channel === 'EMAIL') {
          if (this.mail.enabled) {
            if (!(await this.mail.send({ to: n.recipient, subject: n.subject ?? '', text: n.body }))) throw new Error('SMTP delivery failed');
          } else {
            await this.mail.send({ to: n.recipient, subject: n.subject ?? '', text: n.body });
            note = 'ไม่ได้ตั้งค่า SMTP — บันทึกใน log เท่านั้น';
          }
        } else if (n.channel === 'LINE') {
          await this.line.push(n.recipient, n.body);
        }
        await this.prisma.notificationLog.update({ where: { id }, data: { status: 'SENT', sentAt: new Date(), error: note } });
        sent++;
      } catch (e) {
        const last = n.attempts >= MAX_ATTEMPTS;
        await this.prisma.notificationLog.update({
          where: { id },
          data: { status: last ? 'FAILED' : 'QUEUED', error: String((e as Error)?.message ?? e).slice(0, 2000), nextAttemptAt: new Date(Date.now() + backoffMs(n.attempts)) },
        });
        failed++;
      }
    }
    return { sent, failed };
  }

  // ───────────── inbox ─────────────

  async inbox(user: AuthUser, q: PageQueryDto & { unread?: string }) {
    const where: Prisma.NotificationWhereInput = { userId: user.id, ...(q.unread === 'true' ? { readAt: null } : {}) };
    const [rows, total, unread] = await this.prisma.$transaction([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.perPage, select: { id: true, type: true, title: true, body: true, link: true, readAt: true, createdAt: true } }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    const page = Paginated.of(rows, total, q);
    return Object.assign(page, { meta: { ...page.meta, unread } });
  }

  async unreadCount(user: AuthUser) {
    return { unread: await this.prisma.notification.count({ where: { userId: user.id, readAt: null } }) };
  }

  async markRead(user: AuthUser, id?: string) {
    const n = await this.prisma.notification.updateMany({ where: { userId: user.id, readAt: null, ...(id ? { id } : {}) }, data: { readAt: new Date() } });
    return { updated: n.count };
  }

  // ───────────── preferences & LINE ─────────────

  async preferences(user: AuthUser) {
    const [pref, line] = await Promise.all([
      this.prisma.notificationPreference.findUnique({ where: { userId: user.id } }),
      this.prisma.lineAccount.findUnique({ where: { userId: user.id }, select: { linkedAt: true } }),
    ]);
    return {
      email: pref?.email ?? true,
      line: pref?.line ?? true,
      lineLinked: !!line,
      lineLinkedAt: line?.linkedAt ?? null,
      lineAvailable: this.line.webhookEnabled,
      lineBotId: this.line.botId ?? null,
      emailAvailable: this.mail.enabled,
    };
  }

  async setPreferences(user: AuthUser, dto: { email?: boolean; line?: boolean }) {
    await this.prisma.notificationPreference.upsert({
      where: { userId: user.id },
      create: { userId: user.id, email: dto.email ?? true, line: dto.line ?? true },
      update: { ...(dto.email !== undefined ? { email: dto.email } : {}), ...(dto.line !== undefined ? { line: dto.line } : {}) },
    });
    return this.preferences(user);
  }

  /** 8-digit one-time code the user sends to the official account (10 minutes). */
  async lineLinkCode(user: AuthUser) {
    if (!this.line.webhookEnabled) throw new AppError('LINE_DISABLED', 'ยังไม่ได้เปิดใช้การแจ้งเตือนผ่าน LINE', HttpStatus.CONFLICT);
    const code = String(randomInt(10_000_000, 100_000_000));
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await this.prisma.$transaction([
      this.prisma.lineLinkCode.deleteMany({ where: { userId: user.id } }),
      this.prisma.lineLinkCode.create({ data: { codeHash: sha256(code), userId: user.id, expiresAt } }),
    ]);
    return { code, expiresAt, botId: this.line.botId ?? null };
  }

  async unlinkLine(user: AuthUser, meta: RequestMeta) {
    const n = await this.prisma.lineAccount.deleteMany({ where: { userId: user.id } });
    if (n.count) await this.audit.log({ actorId: user.id, action: 'line.unlink', entityType: 'user', entityId: user.id, meta });
    return { unlinked: n.count > 0 };
  }

  /**
   * LINE webhook: a text message that is a valid link code links that LINE user to the account.
   * Other messages get a short help reply. Signature is checked by the controller.
   */
  async handleLineEvents(events: { type?: string; replyToken?: string; source?: { userId?: string }; message?: { type?: string; text?: string } }[]) {
    for (const ev of events.slice(0, 50)) {
      const lineUserId = ev.source?.userId;
      if (ev.type !== 'message' || ev.message?.type !== 'text' || !lineUserId || !/^U[0-9a-f]{32}$/.test(lineUserId)) continue;
      const text = (ev.message.text ?? '').replace(/\s/g, '');
      if (!/^\d{8}$/.test(text)) {
        if (ev.replyToken) await this.line.reply(ev.replyToken, 'ส่งรหัส 8 หลักจากหน้า "ตั้งค่าการแจ้งเตือน" ในระบบ SRU Event Hub เพื่อเชื่อมบัญชี');
        continue;
      }
      const linked = await this.prisma.$transaction(async (tx) => {
        const used = await tx.lineLinkCode.updateMany({ where: { codeHash: sha256(text), usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
        if (!used.count) return null;
        const row = await tx.lineLinkCode.findUniqueOrThrow({ where: { codeHash: sha256(text) } });
        // One LINE account ↔ one user: re-linking moves it.
        await tx.lineAccount.deleteMany({ where: { OR: [{ lineUserId }, { userId: row.userId }] } });
        await tx.lineAccount.create({ data: { userId: row.userId, lineUserId } });
        await this.audit.log({ actorId: row.userId, action: 'line.link', entityType: 'user', entityId: row.userId }, tx);
        return row.userId;
      });
      if (ev.replyToken) await this.line.reply(ev.replyToken, linked ? 'เชื่อมบัญชีเรียบร้อย ท่านจะได้รับการแจ้งเตือนกิจกรรมผ่าน LINE' : 'รหัสไม่ถูกต้องหรือหมดอายุ กรุณาขอรหัสใหม่');
    }
  }

  // ───────────── admin ─────────────

  async logs(q: PageQueryDto & { status?: string; channel?: string }) {
    const where: Prisma.NotificationLogWhereInput = {
      ...(q.status ? { status: q.status as 'QUEUED' | 'SENT' | 'FAILED' } : {}),
      ...(q.channel ? { channel: q.channel as NotificationChannel } : {}),
      ...(q.search ? { OR: [{ recipient: { contains: q.search, mode: 'insensitive' } }, { templateCode: { contains: q.search.toUpperCase() } }, { subject: { contains: q.search, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total, counts] = await this.prisma.$transaction([
      this.prisma.notificationLog.findMany({
        where,
        select: { id: true, channel: true, templateCode: true, recipient: true, subject: true, status: true, error: true, attempts: true, nextAttemptAt: true, sentAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        skip: q.skip,
        take: q.perPage,
      }),
      this.prisma.notificationLog.count({ where }),
      this.prisma.notificationLog.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
    ]);
    const page = Paginated.of(rows.map((r) => ({ ...r, recipient: r.channel === 'LINE' ? `${r.recipient.slice(0, 6)}…` : r.recipient })), total, q);
    return Object.assign(page, { meta: { ...page.meta, counts: Object.fromEntries(counts.map((c) => [c.status, (c._count as { _all: number })._all])) } });
  }

  async retry(id: string, user: AuthUser, meta: RequestMeta) {
    const n = await this.prisma.notificationLog.updateMany({ where: { id, status: 'FAILED' }, data: { status: 'QUEUED', attempts: 0, nextAttemptAt: new Date(), error: null } });
    if (!n.count) throw Errors.invalidState('ส่งซ้ำได้เฉพาะรายการที่ล้มเหลว');
    await this.audit.log({ actorId: user.id, action: 'notification.retry', entityType: 'notification_log', entityId: id, meta });
    return { queued: true };
  }

  async templates() {
    const rows = await this.prisma.notificationTemplate.findMany();
    return Object.entries(DEFAULT_TEMPLATES).map(([code, d]) => ({
      code,
      defaults: d,
      overrides: rows.filter((r) => r.code === code).map((r) => ({ channel: r.channel, subject: r.subject, body: r.body, isActive: r.isActive })),
    }));
  }

  async saveTemplate(code: string, channel: NotificationChannel, dto: { subject?: string | null; body: string; isActive?: boolean }, user: AuthUser, meta: RequestMeta) {
    if (!(code in DEFAULT_TEMPLATES)) throw Errors.notFound('แม่แบบการแจ้งเตือน');
    const row = await this.prisma.notificationTemplate.upsert({
      where: { code_channel: { code, channel } },
      create: { code, channel, subject: dto.subject ?? null, body: dto.body, isActive: dto.isActive ?? true },
      update: { subject: dto.subject ?? null, body: dto.body, isActive: dto.isActive ?? true },
    });
    this.overrides = null;
    await this.audit.log({ actorId: user.id, action: 'notification_template.update', entityType: 'notification_template', entityId: row.id, after: { code, channel, isActive: row.isActive }, meta });
    return row;
  }

  // ───────────── helpers ─────────────

  private async template(code: string) {
    const base: TemplateText = DEFAULT_TEMPLATES[code] ?? { title: code, body: '' };
    if (!this.overrides || Date.now() - this.overrides.at > 60_000) {
      const rows = await this.prisma.notificationTemplate.findMany({ where: { isActive: true } });
      this.overrides = { at: Date.now(), map: new Map(rows.map((r) => [`${r.code}:${r.channel}`, { subject: r.subject, body: r.body }])) };
    }
    const o = (ch: string) => this.overrides!.map.get(`${code}:${ch}`);
    return {
      base,
      in: o('IN_APP') ?? { subject: base.title, body: base.body },
      email: o('EMAIL') ?? { subject: base.emailSubject ?? base.title, body: base.emailBody ?? base.body },
      line: o('LINE') ?? { subject: null, body: base.body },
    };
  }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
