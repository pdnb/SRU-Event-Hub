import type { CookieOptions, Response } from 'express';
import { randomBytes } from 'node:crypto';

export const ACCESS_COOKIE = 'sru_at';
export const REFRESH_COOKIE = 'sru_rt';
export const CSRF_COOKIE = 'sru_csrf';

export interface CookieConfig {
  secure: boolean;
  domain?: string;
  accessTtlSec: number;
  refreshTtlDays: number;
}

const base = (c: CookieConfig): CookieOptions => ({
  secure: c.secure,
  sameSite: 'lax',
  domain: c.domain || undefined,
});

export function setAuthCookies(res: Response, c: CookieConfig, access: string, refresh: string) {
  res.cookie(ACCESS_COOKIE, access, {
    ...base(c),
    httpOnly: true,
    path: '/',
    maxAge: c.accessTtlSec * 1000,
  });
  // Refresh token is only ever sent to the auth endpoints.
  res.cookie(REFRESH_COOKIE, refresh, {
    ...base(c),
    httpOnly: true,
    path: '/api/v1/auth',
    maxAge: c.refreshTtlDays * 86400_000,
  });
  // Readable by JS so the SPA can echo it in X-CSRF-Token.
  res.cookie(CSRF_COOKIE, randomBytes(24).toString('base64url'), {
    ...base(c),
    httpOnly: false,
    path: '/',
    maxAge: c.refreshTtlDays * 86400_000,
  });
}

export function clearAuthCookies(res: Response, c: CookieConfig) {
  res.clearCookie(ACCESS_COOKIE, { ...base(c), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base(c), path: '/api/v1/auth' });
  res.clearCookie(CSRF_COOKIE, { ...base(c), path: '/' });
}
