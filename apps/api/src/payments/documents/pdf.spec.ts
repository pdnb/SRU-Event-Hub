import { layoutLines } from './pdf';

/** 1 unit per character: easy to reason about line widths. */
const measure = (s: string) => [...s].length;

describe('layoutLines', () => {
  it('wraps Thai at word boundaries', () => {
    expect(layoutLines('มหาวิทยาลัยราชภัฏสุราษฎร์ธานี', 12, measure).split('\n')).toEqual(['มหาวิทยาลัย', 'ราชภัฏ', 'สุราษฎร์ธานี']);
  });
  it('keeps times, amounts and bracketed words together', () => {
    expect(layoutLines('5 พ.ย. 2569 14:30 น.', 12, measure)).toContain('14:30');
    expect(layoutLines('จำนวนเงิน (บาท)', 10, measure).split('\n')).toEqual(['จำนวนเงิน', '(บาท)']);
  });
  it('breaks long codes after a dash, then between graphemes as a last resort', () => {
    expect(layoutLines('PAY-2570-000001', 10, measure).split('\n')).toEqual(['PAY-2570-', '000001']);
    expect(layoutLines('ABCDEFGHIJKL', 5, measure).split('\n')).toEqual(['ABCDE', 'FGHIJ', 'KL']);
  });
  it('never puts a Thai vowel or tone mark on its own', () => {
    for (const line of layoutLines('ปู่ย่าตายาย', 2, measure).split('\n')) expect(line).not.toMatch(/^[ัิ-ฺ็-๎]/);
  });
});
