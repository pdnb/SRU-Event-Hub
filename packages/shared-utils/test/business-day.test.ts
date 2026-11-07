import { bangkokDateKey, businessDayDeadline } from '../src/thai-date';

// Instants are given in Bangkok time (+07:00).
const bkk = (s: string) => new Date(`${s}+07:00`);

describe('businessDayDeadline (FIN-7)', () => {
  it('Monday → end of Tuesday', () => {
    expect(businessDayDeadline(bkk('2026-11-09T15:00:00'), 1).toISOString()).toBe(bkk('2026-11-10T23:59:59.999').toISOString());
  });
  it('Friday evening → end of Monday', () => {
    expect(businessDayDeadline(bkk('2026-11-13T20:00:00'), 1).toISOString()).toBe(bkk('2026-11-16T23:59:59.999').toISOString());
  });
  it('Saturday → end of Monday', () => {
    expect(businessDayDeadline(bkk('2026-11-14T10:00:00'), 1).toISOString()).toBe(bkk('2026-11-16T23:59:59.999').toISOString());
  });
  it('skips configured holidays', () => {
    expect(businessDayDeadline(bkk('2026-12-04T10:00:00'), 1, ['2026-12-07']).toISOString()).toBe(bkk('2026-12-08T23:59:59.999').toISOString());
  });
  it('uses the Bangkok date, not the UTC date', () => {
    // 2026-11-10 00:30 Bangkok is still 2026-11-09 in UTC.
    expect(businessDayDeadline(bkk('2026-11-10T00:30:00'), 1).toISOString()).toBe(bkk('2026-11-11T23:59:59.999').toISOString());
  });
  it('n = 0 → end of the same (or next) business day', () => {
    expect(businessDayDeadline(bkk('2026-11-09T09:00:00'), 0).toISOString()).toBe(bkk('2026-11-09T23:59:59.999').toISOString());
    expect(businessDayDeadline(bkk('2026-11-14T09:00:00'), 0).toISOString()).toBe(bkk('2026-11-16T23:59:59.999').toISOString());
  });
  it('bangkokDateKey', () => {
    expect(bangkokDateKey(bkk('2026-11-10T00:30:00'))).toBe('2026-11-10');
  });
});
