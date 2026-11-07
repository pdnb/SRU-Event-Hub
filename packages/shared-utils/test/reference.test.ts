import { formatReceiptNo, normalizeReceiptNo } from '../src/reference';

describe('receipt numbers (FIN-2)', () => {
  it('pads the running number to 4 digits', () => {
    expect(normalizeReceiptNo('1')).toBe('0001');
    expect(normalizeReceiptNo(' 0001 ')).toBe('0001');
    expect(normalizeReceiptNo('12345')).toBe('12345');
  });
  it('rejects non-numeric, zero and negative input', () => {
    for (const s of ['', '0', '000', '-1', '1a', '2569/0001', '1.5']) expect(normalizeReceiptNo(s)).toBeNull();
  });
  it('formats as fiscal year / number', () => {
    expect(formatReceiptNo(2569, '0001')).toBe('2569/0001');
  });
});
