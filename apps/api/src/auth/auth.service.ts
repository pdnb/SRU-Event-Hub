import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { RequestMeta } from '../common/decorators';
import { AppError } from '../common/errors';
import type { Env } from '../config/env';
import { LoginMethod, UserType } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload, AuthUser } from './auth.types';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

/** OWASP-recommended argon2id parameters (m=19 MiB, t=2, p=1). */
export const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} satisfies argon2.HashOptions;

export const hashPassword = (pw: string): Promise<string> => argon2.hash(pw, { ...ARGON2_OPTS, raw: false });
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** Pre-computed hash so unknown usernames cost the same time as wrong passwords. */
  private readonly dummyHash = hashPassword(randomBytes(16).toString('hex'));

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async login(identifier: string, password: string, meta: RequestMeta) {
    const id = identifier.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: id }, { username: { equals: id, mode: 'insensitive' } }], deletedAt: null },
    });

    const fail = async (reason: string, userId?: string) => {
      await this.prisma.loginHistory.create({
        data: { userId, identifier: id, method: LoginMethod.PASSWORD, success: false, failureReason: reason, ip: meta.ip, userAgent: meta.userAgent },
      });
      return new AppError('INVALID_CREDENTIALS', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', HttpStatus.UNAUTHORIZED);
    };

    if (!user || !user.passwordHash) {
      await argon2.verify(await this.dummyHash, password).catch(() => false);
      throw await fail('unknown_user');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError('ACCOUNT_LOCKED', `บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่ภายหลัง`, HttpStatus.TOO_MANY_REQUESTS);
    }
    const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!ok) {
      const failed = user.failedLogins + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: failed >= MAX_FAILED ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        },
      });
      throw await fail('bad_password', user.id);
    }
    if (user.status === 'PENDING_VERIFICATION') {
      // The password was correct, so telling the owner why is not an enumeration leak.
      await fail('status_pending_verification', user.id);
      throw new AppError('EMAIL_NOT_VERIFIED', 'กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ (ตรวจสอบลิงก์ในกล่องจดหมาย หรือขอลิงก์ใหม่)', HttpStatus.FORBIDDEN);
    }
    if (user.status !== 'ACTIVE') throw await fail(`status_${user.status.toLowerCase()}`, user.id);

    // Transparently upgrade hashes created with weaker parameters.
    if (argon2.needsRehash(user.passwordHash, ARGON2_OPTS)) {
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } });
    }
    return this.completeLogin(user.id, LoginMethod.PASSWORD, id, meta);
  }

  /** Google OIDC: link by (provider, sub); first login links to an existing account by e-mail. */
  async loginWithGoogle(profile: { sub: string; email: string; emailVerified: boolean; name: string; hd?: string }, meta: RequestMeta) {
    const allowed = (this.config.get('GOOGLE_ALLOWED_DOMAINS', { infer: true }) ?? '')
      .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
    const email = profile.email.toLowerCase();
    const domain = email.split('@')[1] ?? '';
    if (!profile.emailVerified || (allowed.length && !allowed.includes(domain))) {
      throw new AppError('DOMAIN_NOT_ALLOWED', 'อนุญาตเฉพาะบัญชีของมหาวิทยาลัย', HttpStatus.FORBIDDEN);
    }

    const identity = await this.prisma.authIdentity.findUnique({
      where: { provider_subject: { provider: 'google', subject: profile.sub } },
    });
    let userId = identity?.userId;
    if (!userId) {
      const existing = await this.prisma.user.findUnique({ where: { email } });
      const user =
        existing ??
        (await this.prisma.user.create({
          data: {
            email,
            displayName: profile.name || email,
            // Student accounts conventionally have a numeric local part (configurable later).
            userType: /^\d+$/.test(email.split('@')[0]!) ? UserType.STUDENT : UserType.STAFF,
            emailVerifiedAt: new Date(),
          },
        }));
      await this.prisma.authIdentity.create({
        data: { userId: user.id, provider: 'google', subject: profile.sub, email },
      });
      userId = user.id;
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status !== 'ACTIVE' || user.deletedAt) {
      throw new AppError('ACCOUNT_DISABLED', 'บัญชีถูกระงับการใช้งาน', HttpStatus.FORBIDDEN);
    }
    await this.prisma.authIdentity.update({
      where: { provider_subject: { provider: 'google', subject: profile.sub } },
      data: { lastUsedAt: new Date() },
    });
    return this.completeLogin(user.id, LoginMethod.GOOGLE, email, meta);
  }

  private async completeLogin(userId: string, method: LoginMethod, identifier: string, meta: RequestMeta) {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null },
      }),
      this.prisma.loginHistory.create({
        data: { userId, identifier, method, success: true, ip: meta.ip, userAgent: meta.userAgent },
      }),
    ]);
    return this.issue(userId, randomUUID(), meta);
  }

  /**
   * Refresh-token rotation. Each refresh token is single-use; presenting an
   * already-rotated token means it was stolen, so the whole family is revoked.
   */
  async refresh(token: string | undefined, meta: RequestMeta): Promise<IssuedTokens> {
    const invalid = () => new AppError('INVALID_REFRESH_TOKEN', 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 401);
    if (!token) throw invalid();
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.revokedAt || row.expiresAt < new Date()) throw invalid();

    if (row.rotatedAt) {
      this.logger.warn({ userId: row.userId, familyId: row.familyId }, 'Refresh token reuse detected – revoking family');
      await this.revokeFamily(row.familyId);
      throw invalid();
    }
    // Atomic claim: only one concurrent refresh can rotate this token.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: new Date() },
    });
    if (claimed.count !== 1) throw invalid();

    const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (!user || user.status !== 'ACTIVE' || user.deletedAt) {
      await this.revokeFamily(row.familyId);
      throw invalid();
    }
    await this.prisma.loginHistory.create({
      data: { userId: user.id, identifier: user.email, method: LoginMethod.REFRESH, success: true, ip: meta.ip, userAgent: meta.userAgent },
    });
    return this.issue(user.id, row.familyId, meta);
  }

  async logout(token: string | undefined) {
    if (!token) return;
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (row) await this.revokeFamily(row.familyId);
  }

  private revokeFamily(familyId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issue(userId: string, familyId: string, meta: RequestMeta): Promise<IssuedTokens> {
    const ttl = this.config.get('JWT_ACCESS_TTL', { infer: true });
    const days = this.config.get('JWT_REFRESH_TTL_DAYS', { infer: true });
    const payload: AccessTokenPayload = { sub: userId, typ: 'access' };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: ttl });
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + days * 86400_000),
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    return { accessToken, refreshToken, expiresIn: ttl };
  }

  async loadAuthUser(userId: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, status: 'ACTIVE', deletedAt: null },
      include: {
        roles: {
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
      },
    });
    if (!user) return null;
    const grants = user.roles.map((ur) => ({
      code: ur.role.code,
      organizationId: ur.organizationId,
      scope: ur.scope,
      permissions: ur.role.permissions.map((rp) => rp.permission.code),
    }));
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      grants,
      permissions: new Set(grants.flatMap((g) => g.permissions)),
    };
  }
}
