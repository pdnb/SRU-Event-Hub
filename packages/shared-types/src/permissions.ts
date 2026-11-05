/**
 * Permission codes are `<resource>:<action>`. Roles are data (DB), permissions
 * are code — the catalogue below is seeded into the `permissions` table and
 * referenced by `@RequirePermissions()` on the backend and `<Can>` on the web.
 */

export const ACTIONS = [
  'view',
  'create',
  'update',
  'delete',
  'approve',
  'export',
  'print',
  'reprint',
  // finance
  'verify',
  'collect',
  'void',
  'waive',
  'refund',
  'submit',
  'receive',
  'reconcile',
] as const;
export type Action = (typeof ACTIONS)[number];

export const RESOURCES = [
  'user',
  'role',
  'organization',
  'event',
  'event_category',
  'approval',
  'registration',
  'group',
  'participant_org',
  'payment',
  'cashier',
  'finance_batch',
  'receipt',
  'refund',
  'bank_account',
  'income_code',
  'checkin',
  'attendance',
  'badge',
  'certificate',
  'evaluation',
  'venue',
  'report',
  'audit_log',
  'system_setting',
] as const;
export type Resource = (typeof RESOURCES)[number];

export type PermissionCode = `${Resource}:${Action}`;

/** Data scope attached to a user-role assignment. */
export const DataScope = {
  OWN: 'OWN', // only records the user created / coordinates
  ORGANIZATION: 'ORGANIZATION', // the assigned organization
  ORGANIZATION_TREE: 'ORGANIZATION_TREE', // assigned organization + descendants
  ALL: 'ALL',
} as const;
export type DataScope = (typeof DataScope)[keyof typeof DataScope];

export const ROLE_CODES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  SYSTEM_ADMIN: 'SYSTEM_ADMIN',
  EXECUTIVE: 'EXECUTIVE',
  CENTRAL_EVENT_ADMIN: 'CENTRAL_EVENT_ADMIN',
  ORG_ADMIN: 'ORG_ADMIN',
  EVENT_MANAGER: 'EVENT_MANAGER',
  APPROVER: 'APPROVER',
  FINANCE_OFFICER: 'FINANCE_OFFICER',
  ORG_FINANCE_OFFICER: 'ORG_FINANCE_OFFICER',
  EVENT_CASHIER: 'EVENT_CASHIER',
  EVENT_STAFF: 'EVENT_STAFF',
  LECTURER_STAFF: 'LECTURER_STAFF',
  STUDENT: 'STUDENT',
  ORG_COORDINATOR: 'ORG_COORDINATOR',
  GUEST: 'GUEST',
} as const;
export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES];
