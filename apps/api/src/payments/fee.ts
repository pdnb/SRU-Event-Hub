/** Minimal shape needed to choose a fee (works with Prisma rows and test fixtures). */
export interface FeeRateLike {
  id: string;
  participantTypeId: string | null;
  amount: { toString(): string } | string;
  validFrom: Date | null;
  validUntil: Date | null;
  isActive: boolean;
  sortOrder: number;
}

const inWindow = (r: FeeRateLike, at: Date) =>
  (!r.validFrom || r.validFrom <= at) && (!r.validUntil || at < r.validUntil);

/**
 * Picks the fee that applies to a participant type at a moment in time.
 *
 * Rules (documented in docs/PAYMENT.md):
 *  1. Only active rates whose window contains `at` (valid_from inclusive, valid_until exclusive).
 *  2. A rate for the specific participant type beats a generic rate (participant_type_id NULL).
 *  3. Among equally specific rates the lowest amount wins (overlapping early-bird windows
 *     never overcharge), then sort order.
 *
 * Returns null when nothing applies – the caller decides whether that means "free" or "not open".
 */
export function selectFeeRate<T extends FeeRateLike>(rates: T[], participantTypeId: string, at: Date): T | null {
  const live = rates.filter((r) => r.isActive && inWindow(r, at));
  const specific = live.filter((r) => r.participantTypeId === participantTypeId);
  const pool = specific.length ? specific : live.filter((r) => r.participantTypeId === null);
  if (!pool.length) return null;
  return [...pool].sort((a, b) => {
    const diff = Number(a.amount.toString()) - Number(b.amount.toString());
    return diff !== 0 ? diff : a.sortOrder - b.sortOrder;
  })[0]!;
}

/**
 * When a PENDING_PAYMENT seat expires: `now + windowHours`, but never after the event starts
 * (and never earlier than 1 hour from now, so a late registrant still gets a usable window).
 */
export function paymentDueAt(now: Date, windowHours: number, eventStartAt: Date): Date {
  const due = new Date(now.getTime() + windowHours * 3_600_000);
  const cap = new Date(Math.max(eventStartAt.getTime(), now.getTime() + 3_600_000));
  return due < cap ? due : cap;
}
