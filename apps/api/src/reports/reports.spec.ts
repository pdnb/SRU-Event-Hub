import { fillMonths } from './reports.service';

describe('fillMonths', () => {
  it('covers the whole fiscal year in Bangkok months and keeps existing rows', () => {
    // FY 2570: 1 Oct 2026 00:00 +07 → 1 Oct 2027 00:00 +07
    const from = new Date('2026-09-30T17:00:00Z');
    const to = new Date('2027-09-30T17:00:00Z');
    const out = fillMonths(from, to, [{ month: '2026-11', n: 5 }], { n: 0 });
    expect(out).toHaveLength(12);
    expect(out[0]).toEqual({ month: '2026-10', n: 0 });
    expect(out[1]).toEqual({ month: '2026-11', n: 5 });
    expect(out.at(-1)!.month).toBe('2027-09');
  });

  it('handles a period inside one month and an empty result', () => {
    expect(fillMonths<{ month: string; n: number }>(new Date('2026-12-05T00:00:00Z'), new Date('2026-12-20T00:00:00Z'), [], { n: 0 })).toEqual([{ month: '2026-12', n: 0 }]);
  });
});
