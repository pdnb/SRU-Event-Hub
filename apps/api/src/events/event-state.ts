import { EventStatus } from '../generated/prisma/enums';

/**
 * Event lifecycle (docs/WORKFLOW.md). Approval status is tracked separately on
 * the event (approval_status) and in approval_requests; this table only governs
 * the event's own status.
 */
export const EVENT_TRANSITIONS: Record<EventStatus, readonly EventStatus[]> = {
  DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'DRAFT', 'CANCELLED'],
  REJECTED: ['PENDING_APPROVAL', 'CANCELLED'],
  APPROVED: ['PUBLISHED', 'CANCELLED'],
  PUBLISHED: ['REGISTRATION_OPEN', 'IN_PROGRESS', 'CANCELLED'],
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED', 'CANCELLED'],
  REGISTRATION_CLOSED: ['REGISTRATION_OPEN', 'IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(from: EventStatus, to: EventStatus): boolean {
  return EVENT_TRANSITIONS[from].includes(to);
}

/** Statuses whose full content may be edited (before approval / after being sent back). */
export const EDITABLE_STATUSES: readonly EventStatus[] = ['DRAFT', 'REJECTED'];

/** Statuses visible on the public portal. */
export const PUBLIC_STATUSES: readonly EventStatus[] = [
  'PUBLISHED',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'IN_PROGRESS',
  'COMPLETED',
];

export interface RegistrationWindow {
  status: EventStatus;
  registrationOpenAt: Date | null;
  registrationCloseAt: Date | null;
  endAt: Date;
}

/**
 * Whether registrations are accepted right now.
 *  - REGISTRATION_OPEN: until the close time (if any) and never after the event ends
 *  - PUBLISHED with an open time: automatically opens inside [open, close)
 * Anything else is closed. No background job is needed for auto-open.
 */
export function isRegistrationOpen(e: RegistrationWindow, now = new Date()): boolean {
  if (now >= e.endAt) return false;
  const beforeClose = !e.registrationCloseAt || now < e.registrationCloseAt;
  if (e.status === 'REGISTRATION_OPEN') return beforeClose;
  if (e.status === 'PUBLISHED' && e.registrationOpenAt) {
    return now >= e.registrationOpenAt && beforeClose;
  }
  return false;
}
