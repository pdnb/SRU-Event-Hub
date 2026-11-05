import type { DataScope } from '../generated/prisma/client';

export interface RoleGrant {
  code: string;
  organizationId: string | null;
  scope: DataScope;
  permissions: string[];
}

/** Attached to `req.user` after JWT validation. Loaded fresh from DB on each request. */
export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  grants: RoleGrant[];
  /** Union of all permission codes over all grants. */
  permissions: Set<string>;
}

export interface AccessTokenPayload {
  sub: string;
  typ: 'access';
}
