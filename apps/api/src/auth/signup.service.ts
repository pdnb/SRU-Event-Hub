import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../common/audit.service';
import type { RequestMeta } from '../common/decorators';
import { AppError } from '../common/errors';
import { MailService } from '../common/mail.service';
import type { Env } from '../config/env';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from './auth.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const TOKEN_TTL_MS = 24 * 3600_000;
const RESEND_GAP_MS = 2 * 60_000;

export interface SignupInput {
  email: string;
  password: string;
  displayName: string;
  phone?: string;
}

/**
 * Self sign-up for external users – mainly group coordinators (P3b). The account stays
 * PENDING_VERIFICATION (cannot log in) until the e-mailed link is opened. Every response is the same
 * whether or not the e-mail already has an account, so addresses cannot be enumerated.
 */
@Injectable()
export class SignupService {
  private readonly logger = new Logger(SignupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Off when disabled by config, or in production without an SMTP relay (links could not be delivered). */
  get enabled() {
    return this.config.get('SELF_REGISTRATION_ENABLED', { infer: true }) && (this.mail.enabled || this.config.get('NODE_ENV', { infer: true }) !== 'production');
  }

  async register(dto: SignupInput, meta: RequestMeta) {
    if (!this.enabled) throw new AppError('SELF_REGISTRATION_DISABLED', 'ระบบยังไม่เปิดให้สมัครสมาชิกด้วยตนเอง กรุณาติดต่อผู้ดูแลระบบ', HttpStatus.FORBIDDEN);
    const email = dto.email.trim().toLowerCase();
    const ssoDomains = (this.config.get('GOOGLE_ALLOWED_DOMAINS', { infer: true }) ?? 'sru.ac.th').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
    if (ssoDomains.some((d) => email.endsWith(`@${d}`))) {
      throw new AppError('USE_SSO', 'บุคลากรและนักศึกษาของมหาวิทยาลัยให้เข้าสู่ระบบด้วยบัญชี Google ของมหาวิทยาลัย', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    if (dto.password.toLowerCase().includes(email.split('@')[0]!) || dto.password.toLowerCase() === email) {
      throw new AppError('WEAK_PASSWORD', 'รหัสผ่านต้องไม่มีชื่ออีเมลของท่าน', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.status === 'PENDING_VERIFICATION' && !existing.deletedAt) await this.sendLink(existing.id, email, existing.displayName, meta);
      else if (!existing.deletedAt) {
        await this.mail.send({
          to: email,
          subject: 'มีบัญชี SRU Event Hub ของอีเมลนี้อยู่แล้ว',
          text: `มีผู้พยายามสมัครสมาชิกด้วยอีเมลนี้ แต่อีเมลนี้มีบัญชีอยู่แล้ว\nเข้าสู่ระบบได้ที่ ${this.webUrl('/login')}\nหากไม่ใช่ท่าน ไม่ต้องดำเนินการใด ๆ`,
        });
      }
      return this.generic();
    }

    const passwordHash = await hashPassword(dto.password);
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            email,
            passwordHash,
            displayName: dto.displayName.trim(),
            userType: 'EXTERNAL',
            status: 'PENDING_VERIFICATION',
            profile: { create: { phone: dto.phone || null } },
          },
        });
        const guest = await tx.role.findUnique({ where: { code: 'GUEST' } });
        if (guest) await tx.userRole.create({ data: { userId: u.id, roleId: guest.id, organizationId: null, scope: 'OWN' } });
        await this.audit.log({ actorId: u.id, action: 'user.self_register', entityType: 'user', entityId: u.id, after: { email }, meta }, tx);
        return u;
      });
      await this.sendLink(user.id, email, user.displayName, meta);
    } catch (e) {
      // Concurrent sign-up with the same address: behave as "already exists".
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
    return this.generic();
  }

  async resend(emailRaw: string, meta: RequestMeta) {
    const email = emailRaw.trim().toLowerCase();
    const u = await this.prisma.user.findUnique({ where: { email } });
    if (u && u.status === 'PENDING_VERIFICATION' && !u.deletedAt) await this.sendLink(u.id, email, u.displayName, meta);
    return this.generic();
  }

  async verify(token: string, meta: RequestMeta) {
    const now = new Date();
    const row = await this.prisma.emailVerification.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!row || row.usedAt || row.expiresAt <= now || row.user.deletedAt) {
      throw new AppError('INVALID_TOKEN', 'ลิงก์ยืนยันไม่ถูกต้องหรือหมดอายุ กรุณาขอลิงก์ใหม่', HttpStatus.BAD_REQUEST);
    }
    await this.prisma.$transaction(async (tx) => {
      // Single use even when the link is opened twice at the same time.
      const claimed = await tx.emailVerification.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
      if (!claimed.count) throw new AppError('INVALID_TOKEN', 'ลิงก์นี้ถูกใช้ไปแล้ว', HttpStatus.BAD_REQUEST);
      await tx.user.updateMany({ where: { id: row.userId, status: 'PENDING_VERIFICATION' }, data: { status: 'ACTIVE', emailVerifiedAt: now } });
      await this.audit.log({ actorId: row.userId, action: 'user.email_verified', entityType: 'user', entityId: row.userId, meta }, tx);
    });
    return { verified: true, email: row.user.email };
  }

  private async sendLink(userId: string, email: string, name: string, meta: RequestMeta) {
    const last = await this.prisma.emailVerification.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    if (last && Date.now() - last.createdAt.getTime() < RESEND_GAP_MS) return; // quietly rate-limited
    const token = randomBytes(32).toString('base64url');
    await this.prisma.emailVerification.create({ data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TOKEN_TTL_MS), ip: meta.ip } });
    await this.mail.send({
      to: email,
      subject: 'ยืนยันอีเมลสำหรับบัญชี SRU Event Hub',
      text: `เรียน ${name}\n\nกรุณายืนยันอีเมลเพื่อเปิดใช้งานบัญชี โดยเปิดลิงก์ต่อไปนี้ภายใน 24 ชั่วโมง\n${this.webUrl(`/verify-email#token=${token}`)}\n\nหากท่านไม่ได้สมัครสมาชิก ไม่ต้องดำเนินการใด ๆ\nมหาวิทยาลัยราชภัฏสุราษฎร์ธานี`,
    });
  }

  private webUrl(path: string) {
    return `${this.config.get('WEB_PUBLIC_URL', { infer: true }).replace(/\/$/, '')}${path}`;
  }

  private generic() {
    return { accepted: true, message: 'หากข้อมูลถูกต้อง ระบบได้ส่งลิงก์ยืนยันไปที่อีเมลของท่านแล้ว กรุณาตรวจสอบกล่องจดหมาย (รวมถึงจดหมายขยะ)' };
  }
}
