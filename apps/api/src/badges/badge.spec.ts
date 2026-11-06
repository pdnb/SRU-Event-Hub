import { renderBadgesPdf, sheetLayout, contrastText } from './badge-pdf';
import { defaultLayout, fillBadgeText, matchColorRule, validateTemplate, type BadgeTemplateSpec } from './badge-template';

describe('badge layout', () => {
  it('fits common badge sizes onto A4, picking the better orientation', () => {
    expect(sheetLayout(90, 55)).toMatchObject({ cols: 3, rows: 3, perPage: 9, landscape: true }); // business-card size: 3×3 landscape beats 2×4 portrait
    expect(sheetLayout(100, 140).perPage).toBe(2); // A6-ish hanging badge → landscape 2 per sheet
    expect(sheetLayout(86, 54).perPage).toBeGreaterThanOrEqual(8);
    expect(sheetLayout(250, 250).perPage).toBe(1); // too big: still one per page
  });

  it('fills placeholders and never prints raw braces', () => {
    expect(fillBadgeText('{prefix}{firstName}  {lastName}', { prefix: 'นาย', firstName: 'สมชาย', lastName: 'ใจดี' })).toBe('นายสมชาย ใจดี');
    expect(fillBadgeText('{unknown} ทดสอบ', {})).toBe('ทดสอบ');
  });

  it('matches colour rules in order with ANY as fallback', () => {
    const rules = defaultLayout(90, 120).colorRules;
    expect(matchColorRule(rules, { personnelRole: 'SPEAKER' })?.label).toBe('วิทยากร');
    expect(matchColorRule(rules, { participantTypeCode: 'STUDENT' })?.matchType).toBe('ANY');
  });

  it('validates fields: inside the badge, scannable QR, known placeholders', () => {
    const ok = defaultLayout(90, 120);
    expect(validateTemplate({ widthMm: 90, heightMm: 120, fields: ok.fields })).toEqual([]);
    expect(validateTemplate({ widthMm: 90, heightMm: 55, fields: defaultLayout(90, 55).fields })).toEqual([]);
    const bad = [
      { ...ok.fields[0]!, xMm: 80, wMm: 20 },
      { ...ok.fields.find((f) => f.kind === 'QR')!, wMm: 8, hMm: 8 },
      { ...ok.fields[0]!, content: '{nope}' },
    ];
    expect(validateTemplate({ widthMm: 90, heightMm: 120, fields: bad })).toHaveLength(3);
  });

  it('picks readable text colour for bands', () => {
    expect(contrastText('#1f3a8a')).toBe('#ffffff');
    expect(contrastText('#facc15')).toBe('#000000');
  });

  it('renders a multi-page PDF with Thai text and QR codes', async () => {
    const spec: BadgeTemplateSpec = { nameTh: 't', paper: 'A4_SHEET', widthMm: 90, heightMm: 55, backgroundColor: null, backgroundFileId: null, ...defaultLayout(90, 55) };
    const subjects = Array.from({ length: 10 }, (_, i) => ({
      qr: `SRU1.${'A'.repeat(21)}${i}`,
      participantTypeCode: 'STUDENT',
      printNo: i === 0 ? 2 : 1,
      vars: { fullName: `นางสาวทดสอบ นามสกุลยาวมากเป็นพิเศษสำหรับการตัดคำภาษาไทย ${i}`, affiliation: 'คณะวิทยาศาสตร์และเทคโนโลยี', eventTitle: 'งานสัมมนาวิชาการ', participantType: 'นักศึกษา', referenceNo: 'REG-2570-000001' },
    }));
    const pdf = await renderBadgesPdf(spec, subjects, { title: 'test' });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBe(2); // 9 per sheet → 2 pages
    const label = await renderBadgesPdf({ ...spec, paper: 'LABEL' }, subjects.slice(0, 3), { title: 'label' });
    expect((label.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBe(3);
  });
});
