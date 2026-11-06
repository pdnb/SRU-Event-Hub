import { ratingLevel } from '../evaluations/evaluations.service';
import { renderCertificatesPdf } from './certificate-pdf';
import {
  checkEligibility,
  defaultCertLayout,
  fillCertText,
  formatVerifyCode,
  newVerifyCode,
  normalizeVerifyCode,
  validateCertTemplate,
} from './certificate-template';

const rules = { requireAttendance: true, countLate: true, minSessionPercent: null, requireEvaluation: false };
const facts = { registrationStatus: 'CONFIRMED', attendance: 'PRESENT', sessionsTotal: 0, sessionsAttended: 0, evaluationsRequired: 0, evaluationsDone: 0 };

describe('checkEligibility', () => {
  it('passes a confirmed registrant who attended', () => {
    expect(checkEligibility(rules, facts)).toEqual({ eligible: true, reasons: [] });
  });

  it('requires a confirmed registration and attendance', () => {
    const r = checkEligibility(rules, { ...facts, registrationStatus: 'PENDING_PAYMENT', attendance: null });
    expect(r.eligible).toBe(false);
    expect(r.reasons).toHaveLength(2);
  });

  it('counts LATE only when the template allows it; EXCUSED never counts', () => {
    expect(checkEligibility(rules, { ...facts, attendance: 'LATE' }).eligible).toBe(true);
    expect(checkEligibility({ ...rules, countLate: false }, { ...facts, attendance: 'LATE' }).reasons).toEqual(['มาสายเกินเกณฑ์ที่กำหนด']);
    expect(checkEligibility(rules, { ...facts, attendance: 'EXCUSED' }).eligible).toBe(false);
  });

  it('applies the session percentage only when the event has sessions', () => {
    const r80 = { ...rules, minSessionPercent: 80 };
    expect(checkEligibility(r80, { ...facts, sessionsTotal: 5, sessionsAttended: 4 }).eligible).toBe(true);
    expect(checkEligibility(r80, { ...facts, sessionsTotal: 5, sessionsAttended: 3 }).reasons[0]).toContain('3/5');
    expect(checkEligibility(r80, { ...facts, sessionsTotal: 0 }).eligible).toBe(true);
    // 2/3 = 66.67 % must not round up to pass a 67 % rule
    expect(checkEligibility({ ...rules, minSessionPercent: 67 }, { ...facts, sessionsTotal: 3, sessionsAttended: 2 }).eligible).toBe(false);
  });

  it('requires every required evaluation when the template says so', () => {
    const re = { ...rules, requireEvaluation: true };
    expect(checkEligibility(re, { ...facts, evaluationsRequired: 2, evaluationsDone: 1 }).eligible).toBe(false);
    expect(checkEligibility(re, { ...facts, evaluationsRequired: 2, evaluationsDone: 2 }).eligible).toBe(true);
    expect(checkEligibility(re, { ...facts, evaluationsRequired: 0 }).eligible).toBe(true);
  });

  it('can ignore attendance entirely', () => {
    expect(checkEligibility({ ...rules, requireAttendance: false }, { ...facts, attendance: null }).eligible).toBe(true);
  });
});

describe('verify codes', () => {
  it('generates 12 Crockford base32 characters', () => {
    const codes = new Set(Array.from({ length: 500 }, newVerifyCode));
    expect(codes.size).toBe(500);
    for (const c of codes) expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
  });

  it('normalises typed input (case, dashes, O/I/L confusions)', () => {
    const c = newVerifyCode();
    expect(normalizeVerifyCode(formatVerifyCode(c).toLowerCase())).toBe(c);
    expect(normalizeVerifyCode('o1l2-ABCD-EFGH')).toBe('0112ABCDEFGH');
    expect(normalizeVerifyCode('UUUU-UUUU-UUUU')).toBeNull();
    expect(normalizeVerifyCode('short')).toBeNull();
    expect(normalizeVerifyCode("'; drop table--")).toBeNull();
  });
});

describe('certificate template', () => {
  it('default A4 layouts are valid in both orientations', () => {
    expect(validateCertTemplate({ widthMm: 297, heightMm: 210, fields: defaultCertLayout(297, 210) })).toEqual([]);
    expect(validateCertTemplate({ widthMm: 210, heightMm: 297, fields: defaultCertLayout(210, 297) })).toEqual([]);
  });

  it('rejects a layout without the recipient name, unknown placeholders and tiny QR codes', () => {
    const base = defaultCertLayout(297, 210);
    const noName = base.filter((f) => !f.content?.includes('{fullName}'));
    expect(validateCertTemplate({ widthMm: 297, heightMm: 210, fields: noName })).toContain('ต้องมีช่องแสดงชื่อผู้รับ ({fullName})');
    const bad = [...base, { ...base[0]!, content: '{password}' }, { ...base[6]!, wMm: 10, hMm: 10 }];
    const errors = validateCertTemplate({ widthMm: 297, heightMm: 210, fields: bad });
    expect(errors.some((e) => e.includes('{password}'))).toBe(true);
    expect(errors.some((e) => e.includes('QR'))).toBe(true);
  });

  it('fills placeholders and drops unknown ones', () => {
    expect(fillCertText('ได้เข้าร่วม{eventTitle} {nope}', { eventTitle: 'สัมมนา' })).toBe('ได้เข้าร่วมสัมมนา');
  });

  it('renders a PDF with one page per certificate (mixed template sizes)', async () => {
    const vars = { fullName: 'นายทดสอบ ระบบ', eventTitle: 'สัมมนา', eventDate: '1 ม.ค. 2570', venue: 'ห้อง 1', issueDate: '2 ม.ค. 2570', certificateNo: 'CERT-2570-000001', verifyUrl: 'https://x/verify/AAAA-BBBB-CCCC' };
    const land = { nameTh: 'a', widthMm: 297, heightMm: 210, backgroundColor: '#ffffff', backgroundFileId: null, fields: defaultCertLayout(297, 210) };
    const port = { ...land, widthMm: 210, heightMm: 297, fields: defaultCertLayout(210, 297) };
    const pdf = await renderCertificatesPdf(
      [
        { spec: land, background: null, vars, qr: vars.verifyUrl },
        { spec: port, background: null, vars, qr: vars.verifyUrl, watermark: 'ยกเลิกแล้ว' },
      ],
      { title: 't' },
    );
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBe(2);
  });
});

describe('ratingLevel', () => {
  it('maps 5-point means to the Thai interpretation bands', () => {
    expect(ratingLevel(4.51)).toBe('มากที่สุด');
    expect(ratingLevel(4.5)).toBe('มาก');
    expect(ratingLevel(3)).toBe('ปานกลาง');
    expect(ratingLevel(1.6)).toBe('น้อย');
    expect(ratingLevel(1)).toBe('น้อยที่สุด');
  });
});
