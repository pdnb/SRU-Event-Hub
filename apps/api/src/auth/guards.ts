import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { IS_PUBLIC, PERMISSIONS } from '../common/decorators';
import { AppError, Errors } from '../common/errors';
import { ACCESS_COOKIE, CSRF_COOKIE } from './cookies';
import type { AuthUser } from './auth.types';

/**
 * Global authentication. Every route requires a valid access token unless
 * decorated with @Public(); on public routes a token is still honoured if present.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!isPublic) return (await super.canActivate(ctx)) as boolean;
    try {
      await super.canActivate(ctx);
    } catch {
      /* anonymous access allowed */
    }
    return true;
  }

  override handleRequest<T>(err: unknown, user: T, _info: unknown, ctx: ExecutionContext): T {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (err || !user) {
      if (isPublic) return undefined as T;
      throw new AppError('UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ', 401);
    }
    return user;
  }
}

/** Backend permission enforcement — the UI hiding a button is never the only control (spec §5). */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user) throw new AppError('UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ', 401);
    if (!required.every((p) => user.permissions.has(p))) throw Errors.forbidden();
    return true;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie-authenticated requests (double-submit token).
 * Requests authenticated with an Authorization: Bearer header are not
 * susceptible to CSRF and skip the check.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (req.headers.authorization?.startsWith('Bearer ')) return true;
    const usesCookieAuth = Boolean(req.cookies?.[ACCESS_COOKIE] || req.cookies?.['sru_rt']);
    if (!usesCookieAuth) return true;

    const cookie = String(req.cookies?.[CSRF_COOKIE] ?? '');
    const header = String(req.headers['x-csrf-token'] ?? '');
    const ok =
      cookie.length >= 16 &&
      cookie.length === header.length &&
      timingSafeEqual(Buffer.from(cookie), Buffer.from(header));
    if (!ok) throw new AppError('CSRF_INVALID', 'คำขอไม่ถูกต้อง (CSRF)', 403);
    return true;
  }
}
