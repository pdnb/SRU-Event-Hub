import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '@sru/shared-types';
import type { AuthUser } from '../auth/auth.types';

export const IS_PUBLIC = 'isPublic';
/** Route needs no login. If a valid token is present the user is still attached. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const PERMISSIONS = 'permissions';
/** All listed permissions are required (checked by PermissionsGuard). */
export const RequirePermissions = (...codes: PermissionCode[]) => SetMetadata(PERMISSIONS, codes);

export const IDEMPOTENT = 'idempotent';
/** Requires an `Idempotency-Key` header; replays the stored response on retries. */
export const Idempotent = (opts: { required?: boolean } = {}) =>
  SetMetadata(IDEMPOTENT, { required: opts.required ?? true });

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined =>
    ctx.switchToHttp().getRequest().user,
);

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

export const ReqMeta = createParamDecorator((_d: unknown, ctx: ExecutionContext): RequestMeta => {
  const req = ctx.switchToHttp().getRequest();
  return {
    ip: req.ip,
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 500),
    requestId: req.id ? String(req.id) : undefined,
  };
});
