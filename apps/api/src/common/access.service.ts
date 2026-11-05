import { Injectable } from '@nestjs/common';
import type { PermissionCode } from '@sru/shared-types';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { Errors } from './errors';

/** `'ALL'` = unrestricted, otherwise the organization ids the user may act on. */
export type OrgScope = 'ALL' | string[];

/**
 * Data-scope resolution (spec §5). A permission is granted through one or more
 * role grants; each grant carries a scope:
 *   ALL               → every organization
 *   ORGANIZATION      → the grant's organization only
 *   ORGANIZATION_TREE → the grant's organization and all descendants
 *   OWN               → no organization rights (callers filter by created_by / owner)
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  has(user: AuthUser | undefined, code: PermissionCode): boolean {
    return !!user && user.permissions.has(code);
  }

  async orgScope(user: AuthUser, code: PermissionCode): Promise<OrgScope> {
    const grants = user.grants.filter((g) => g.permissions.includes(code));
    if (grants.some((g) => g.scope === 'ALL')) return 'ALL';

    const ids = new Set<string>();
    const treeRoots: string[] = [];
    for (const g of grants) {
      if (!g.organizationId) continue;
      ids.add(g.organizationId);
      if (g.scope === 'ORGANIZATION_TREE') treeRoots.push(g.organizationId);
    }
    if (treeRoots.length) {
      for (const id of await this.descendants(treeRoots)) ids.add(id);
    }
    return [...ids];
  }

  /** True when the user holds `code` with a scope that covers `organizationId`. */
  async canOnOrg(user: AuthUser, code: PermissionCode, organizationId: string): Promise<boolean> {
    if (!this.has(user, code)) return false;
    const scope = await this.orgScope(user, code);
    return scope === 'ALL' || scope.includes(organizationId);
  }

  async assertOrg(user: AuthUser, code: PermissionCode, organizationId: string) {
    if (!(await this.canOnOrg(user, code, organizationId))) throw Errors.forbidden();
  }

  /** Has `code` only with OWN scope (e.g. an event manager limited to own events). */
  ownOnly(user: AuthUser, code: PermissionCode): boolean {
    const grants = user.grants.filter((g) => g.permissions.includes(code));
    return grants.length > 0 && grants.every((g) => g.scope === 'OWN');
  }

  /** Recursive CTE over the organization tree. */
  async descendants(rootIds: string[]): Promise<string[]> {
    if (!rootIds.length) return [];
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE tree AS (
        SELECT id FROM organizations WHERE id = ANY(${rootIds}::uuid[])
        UNION
        SELECT o.id FROM organizations o JOIN tree t ON o.parent_id = t.id
      )
      SELECT id::text AS id FROM tree`;
    return rows.map((r) => r.id);
  }

  /** The organization and all its ancestors, nearest first. */
  async ancestors(organizationId: string): Promise<{ id: string; headUserId: string | null }[]> {
    return this.prisma.$queryRaw<{ id: string; headUserId: string | null }[]>`
      WITH RECURSIVE chain AS (
        SELECT id, parent_id, head_user_id, 0 AS depth FROM organizations WHERE id = ${organizationId}::uuid
        UNION ALL
        SELECT o.id, o.parent_id, o.head_user_id, c.depth + 1
        FROM organizations o JOIN chain c ON o.id = c.parent_id
      )
      SELECT id::text AS id, head_user_id::text AS "headUserId" FROM chain ORDER BY depth`;
  }
}
