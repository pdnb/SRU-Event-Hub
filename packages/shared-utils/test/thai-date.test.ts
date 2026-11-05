import { fiscalYearBE, fiscalYearRange, formatThaiDate, thaiCollator } from '../src/thai-date';
import { formatReference } from '../src/reference';
import { sanitizeSpreadsheetCell } from '../src/spreadsheet';

describe('fiscal year', () => {
  it('rolls over on 1 October Bangkok time', () => {
    // 2026-09-30 23:59 Bangkok = 16:59 UTC
    expect(fiscalYearBE(new Date('2026-09-30T16:59:00Z'))).toBe(2569);
    // 2026-10-01 00:00 Bangkok = 2026-09-30 17:00 UTC
    expect(fiscalYearBE(new Date('2026-09-30T17:00:00Z'))).toBe(2570);
    expect(fiscalYearBE(new Date('2027-03-15T00:00:00Z'))).toBe(2570);
  });

  it('computes range bounds as Bangkok midnight', () => {
    const { start, end } = fiscalYearRange(2570);
    expect(start.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(end.toISOString()).toBe('2027-09-30T17:00:00.000Z');
  });
});

describe('formatThaiDate', () => {
  it('renders BE year exactly once', () => {
    const s = formatThaiDate(new Date('2026-11-05T03:00:00Z'));
    expect(s).toContain('2569');
    expect(s).not.toContain('3112');
  });
});

describe('thaiCollator', () => {
  it('sorts in Thai dictionary order (leading vowels ignored)', () => {
    const names = ['เกษม', 'กมล', 'ขวัญ', 'ไก่'];
    // Royal Institute dictionary order: consonant clusters first, then vowels เ < ไ.
    expect([...names].sort(thaiCollator.compare)).toEqual(['กมล', 'เกษม', 'ไก่', 'ขวัญ']);
  });
});

describe('formatReference', () => {
  it('pads the running number', () => {
    expect(formatReference('PAY', 2570, 123)).toBe('PAY-2570-000123');
    expect(() => formatReference('pay', 2570, 1)).toThrow();
  });
});

describe('sanitizeSpreadsheetCell', () => {
  it('neutralises formulas but keeps numbers', () => {
    expect(sanitizeSpreadsheetCell('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
    expect(sanitizeSpreadsheetCell('@SUM(A1)')).toBe(`'@SUM(A1)`);
    expect(sanitizeSpreadsheetCell('-150.00')).toBe('-150.00');
    expect(sanitizeSpreadsheetCell('สมชาย')).toBe('สมชาย');
    expect(sanitizeSpreadsheetCell(42)).toBe(42);
  });
});
