import {
  addMoney,
  compareMoney,
  formatMoney,
  fromSatang,
  multiplyMoney,
  normalizeMoney,
  subtractMoney,
  toSatang,
} from '../src/money';

describe('money', () => {
  it('parses and normalises decimal strings without floating point', () => {
    expect(toSatang('1500')).toBe(150000n);
    expect(toSatang('1500.5')).toBe(150050n);
    expect(toSatang('0.01')).toBe(1n);
    expect(normalizeMoney('1500')).toBe('1500.00');
    expect(fromSatang(-150n)).toBe('-1.50');
  });

  it('rejects invalid values', () => {
    for (const bad of ['1.001', 'abc', '', '1,000', '1e3']) {
      expect(() => toSatang(bad)).toThrow();
    }
  });

  it('adds without float drift (0.1 + 0.2)', () => {
    expect(addMoney('0.10', '0.20')).toBe('0.30');
    expect(addMoney('199.99', '0.01', '800.00')).toBe('1000.00');
  });

  it('multiplies and subtracts', () => {
    expect(multiplyMoney('350.00', 12)).toBe('4200.00');
    expect(subtractMoney('100.00', '150.25')).toBe('-50.25');
    expect(() => multiplyMoney('1.00', 1.5)).toThrow();
  });

  it('compares and formats', () => {
    expect(compareMoney('10.00', '9.99')).toBe(1);
    expect(compareMoney('10', '10.00')).toBe(0);
    expect(formatMoney('1234567.8')).toBe('1,234,567.80');
    expect(formatMoney('-1000')).toBe('-1,000.00');
    expect(formatMoney('0')).toBe('0.00');
  });
});
