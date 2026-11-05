import { canTransition, isRegistrationOpen } from './event-state';

describe('event state machine', () => {
  it('allows the main lifecycle and forbids skipping approval', () => {
    expect(canTransition('DRAFT', 'PENDING_APPROVAL')).toBe(true);
    expect(canTransition('DRAFT', 'PUBLISHED')).toBe(false);
    expect(canTransition('PENDING_APPROVAL', 'APPROVED')).toBe(true);
    expect(canTransition('APPROVED', 'PUBLISHED')).toBe(true);
    expect(canTransition('COMPLETED', 'CANCELLED')).toBe(false);
    expect(canTransition('CANCELLED', 'DRAFT')).toBe(false);
  });
});

describe('isRegistrationOpen', () => {
  const now = new Date('2026-11-05T03:00:00Z');
  const base = { registrationOpenAt: null, registrationCloseAt: null, endAt: new Date('2026-12-01T00:00:00Z') };

  it('REGISTRATION_OPEN accepts until close time', () => {
    expect(isRegistrationOpen({ ...base, status: 'REGISTRATION_OPEN' }, now)).toBe(true);
    expect(
      isRegistrationOpen({ ...base, status: 'REGISTRATION_OPEN', registrationCloseAt: new Date('2026-11-01T00:00:00Z') }, now),
    ).toBe(false);
  });

  it('PUBLISHED auto-opens inside the window only', () => {
    const open = new Date('2026-11-01T00:00:00Z');
    expect(isRegistrationOpen({ ...base, status: 'PUBLISHED', registrationOpenAt: open }, now)).toBe(true);
    expect(isRegistrationOpen({ ...base, status: 'PUBLISHED', registrationOpenAt: new Date('2026-11-10T00:00:00Z') }, now)).toBe(false);
    expect(isRegistrationOpen({ ...base, status: 'PUBLISHED' }, now)).toBe(false);
  });

  it('never accepts after the event ended or in non-open statuses', () => {
    expect(isRegistrationOpen({ ...base, status: 'REGISTRATION_OPEN', endAt: new Date('2026-11-01T00:00:00Z') }, now)).toBe(false);
    expect(isRegistrationOpen({ ...base, status: 'DRAFT' }, now)).toBe(false);
    expect(isRegistrationOpen({ ...base, status: 'REGISTRATION_CLOSED' }, now)).toBe(false);
  });
});
