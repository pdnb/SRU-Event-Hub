import { paymentDueAt, selectFeeRate, type FeeRateLike } from './fee';

const d = (s: string) => new Date(s);
const rate = (p: Partial<FeeRateLike> & { id: string; amount: string }): FeeRateLike => ({
  participantTypeId: null,
  validFrom: null,
  validUntil: null,
  isActive: true,
  sortOrder: 0,
  ...p,
});

describe('selectFeeRate', () => {
  const STUDENT = 'pt-student';
  const rates = [
    rate({ id: 'general', amount: '1500.00' }),
    rate({ id: 'early', amount: '1200.00', validUntil: d('2026-12-01T00:00:00Z') }),
    rate({ id: 'student', amount: '300.00', participantTypeId: STUDENT }),
    rate({ id: 'inactive', amount: '1.00', isActive: false }),
  ];

  it('prefers the cheaper overlapping generic rate during early bird', () => {
    expect(selectFeeRate(rates, 'pt-staff', d('2026-11-20T00:00:00Z'))?.id).toBe('early');
  });

  it('falls back to the regular rate after early bird ends (valid_until exclusive)', () => {
    expect(selectFeeRate(rates, 'pt-staff', d('2026-12-01T00:00:00Z'))?.id).toBe('general');
  });

  it('participant-type specific rate beats generic rates', () => {
    expect(selectFeeRate(rates, STUDENT, d('2026-11-20T00:00:00Z'))?.id).toBe('student');
  });

  it('ignores inactive rates and returns null when nothing applies', () => {
    expect(selectFeeRate([rates[3]!], 'x', d('2026-11-20T00:00:00Z'))).toBeNull();
    expect(selectFeeRate([rate({ id: 'late', amount: '9', validFrom: d('2027-01-01T00:00:00Z') })], 'x', d('2026-11-20T00:00:00Z'))).toBeNull();
  });
});

describe('paymentDueAt', () => {
  const now = d('2026-11-05T00:00:00Z');
  it('adds the payment window', () => {
    expect(paymentDueAt(now, 72, d('2026-12-01T00:00:00Z')).toISOString()).toBe('2026-11-08T00:00:00.000Z');
  });
  it('is capped at the event start', () => {
    expect(paymentDueAt(now, 72, d('2026-11-06T00:00:00Z')).toISOString()).toBe('2026-11-06T00:00:00.000Z');
  });
  it('always leaves at least one hour', () => {
    expect(paymentDueAt(now, 72, d('2026-11-05T00:10:00Z')).toISOString()).toBe('2026-11-05T01:00:00.000Z');
  });
});
