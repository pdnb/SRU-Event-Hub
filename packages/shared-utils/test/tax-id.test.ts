import { formatBranch, formatThaiTaxId, isValidThaiTaxId } from '../src/tax-id';

/** Builds a valid id from 12 digits (same formula, written independently). */
const withCheck = (twelve: string) => {
  const s = [...twelve].reduce((a, d, i) => a + Number(d) * (13 - i), 0);
  return twelve + String((11 - (s % 11)) % 10);
};

describe('isValidThaiTaxId', () => {
  it('accepts ids with a correct check digit (incl. separators)', () => {
    for (const twelve of ['010553600031', '099400015933', '110170020703', '000000000000']) {
      const id = withCheck(twelve);
      expect(isValidThaiTaxId(id)).toBe(true);
      expect(isValidThaiTaxId(formatThaiTaxId(id))).toBe(true);
    }
  });
  it('rejects a wrong check digit, wrong length and non-digits', () => {
    const id = withCheck('010553600031');
    const bad = id.slice(0, 12) + String((Number(id[12]) + 1) % 10);
    expect(isValidThaiTaxId(bad)).toBe(false);
    expect(isValidThaiTaxId(id.slice(0, 12))).toBe(false);
    expect(isValidThaiTaxId('01055360003a5')).toBe(false);
  });
});

describe('formatting', () => {
  it('groups digits like the official card', () => {
    expect(formatThaiTaxId('0105536000315')).toBe('0-1055-36000-31-5');
  });
  it('renders branches', () => {
    expect(formatBranch('00000')).toBe('สำนักงานใหญ่');
    expect(formatBranch('00012')).toBe('สาขาที่ 00012');
    expect(formatBranch(null)).toBe('');
  });
});
