import { randomBytes } from 'node:crypto';

/**
 * Certificate template model shared by the designer API, the issue snapshot and the PDF engine.
 * Geometry is millimetres from the page's top-left corner (one certificate per page).
 */

export type CertFieldKind = 'TEXT' | 'QR';
export type CertAlign = 'left' | 'center' | 'right';

export interface CertFieldSpec {
  kind: CertFieldKind;
  content: string | null;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  fontSize: number;
  bold: boolean;
  align: CertAlign;
  color: string | null;
  sortOrder: number;
}

export interface CertTemplateSpec {
  nameTh: string;
  widthMm: number;
  heightMm: number;
  backgroundColor: string | null;
  backgroundFileId: string | null;
  fields: CertFieldSpec[];
}

/** Placeholders a TEXT field may use, with the designer's Thai description. */
export const CERT_PLACEHOLDERS: Record<string, string> = {
  fullName: 'ชื่อ-นามสกุล (รวมคำนำหน้า)',
  prefix: 'คำนำหน้า',
  firstName: 'ชื่อ',
  lastName: 'นามสกุล',
  affiliation: 'หน่วยงาน/คณะ/โรงเรียน',
  role: 'บทบาท (ผู้เข้าร่วม / วิทยากร …)',
  participantType: 'ประเภทผู้เข้าร่วม',
  eventTitle: 'ชื่อกิจกรรม',
  eventCode: 'รหัสกิจกรรม',
  eventDate: 'วันที่จัดกิจกรรม (ช่วงวัน)',
  venue: 'สถานที่',
  organizationName: 'หน่วยงานผู้จัด',
  hours: 'จำนวนชั่วโมงกิจกรรม',
  certificateNo: 'เลขที่เกียรติบัตร',
  verifyCode: 'รหัสตรวจสอบ',
  verifyUrl: 'ลิงก์ตรวจสอบ',
  issueDate: 'วันที่ออกเกียรติบัตร',
};

/** Replaces {key} with vars[key]; unknown keys become empty so a certificate never shows raw braces. */
export function fillCertText(text: string, vars: Record<string, string | null | undefined>): string {
  return text
    .replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function validateCertTemplate(t: Pick<CertTemplateSpec, 'widthMm' | 'heightMm' | 'fields'>): string[] {
  const errors: string[] = [];
  if (!t.fields.some((f) => f.kind === 'TEXT' && /\{(fullName|firstName)\}/.test(f.content ?? ''))) errors.push('ต้องมีช่องแสดงชื่อผู้รับ ({fullName})');
  t.fields.forEach((f, i) => {
    const n = `ช่องที่ ${i + 1}`;
    if (f.xMm < 0 || f.yMm < 0 || f.xMm + f.wMm > t.widthMm + 0.01 || f.yMm + f.hMm > t.heightMm + 0.01) errors.push(`${n} อยู่นอกขอบกระดาษ`);
    if (f.kind === 'QR' && Math.min(f.wMm, f.hMm) < 15) errors.push(`${n}: QR ต้องมีขนาดอย่างน้อย 15 มม. เพื่อให้สแกนได้`);
    if (f.kind === 'TEXT' && !f.content?.trim()) errors.push(`${n}: ยังไม่ได้ระบุข้อความ`);
    for (const m of (f.content ?? '').matchAll(/\{(\w+)\}/g)) if (!(m[1]! in CERT_PLACEHOLDERS)) errors.push(`${n}: ไม่รู้จักตัวแปร {${m[1]}}`);
  });
  return errors;
}

/** A starting layout for A4 (landscape or portrait): heading, name, reason, event, date, verification. */
export function defaultCertLayout(widthMm: number, heightMm: number): CertFieldSpec[] {
  const W = widthMm;
  const H = heightMm;
  const m = Math.round(W * 0.1);
  const inner = W - m * 2;
  const qr = 24;
  const f = (kind: CertFieldKind, content: string | null, y: number, h: number, fontSize: number, bold = false, color: string | null = '#111111', extra: Partial<CertFieldSpec> = {}): CertFieldSpec => ({
    kind, content, xMm: m, yMm: round(y), wMm: inner, hMm: round(h), fontSize, bold, align: 'center', color, sortOrder: 0, ...extra,
  });
  const fields = [
    f('TEXT', '{organizationName}', H * 0.1, 10, 16, true, '#1f3a8a'),
    f('TEXT', 'เกียรติบัตรฉบับนี้ให้ไว้เพื่อแสดงว่า', H * 0.24, 10, 18),
    f('TEXT', '{fullName}', H * 0.33, 18, 34, true, '#1f3a8a'),
    f('TEXT', 'ได้เข้าร่วม{eventTitle}', H * 0.47, 20, 18),
    f('TEXT', 'เมื่อวันที่ {eventDate} ณ {venue}', H * 0.58, 10, 15, false, '#333333'),
    f('TEXT', 'ให้ไว้ ณ วันที่ {issueDate}', H * 0.66, 9, 14, false, '#333333'),
    f('QR', null, H - qr - 10, qr, 12, false, null, { xMm: W - qr - 12, wMm: qr }),
    f('TEXT', 'เลขที่ {certificateNo}\nตรวจสอบ: {verifyUrl}', H - 16, 10, 8, false, '#555555', { xMm: 12, wMm: W - qr - 30, align: 'left' }),
  ];
  return fields.map((x, i) => ({ ...x, sortOrder: i }));
}

const round = (n: number) => Math.round(n * 10) / 10;

// ───────────── verification code ─────────────

/** Crockford base32 without I, L, O, U — easy to read aloud and type. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 12 characters = 60 random bits: unguessable, short enough to type from paper. */
export function newVerifyCode(): string {
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += CROCKFORD[bytes[i]! & 31];
  return out;
}

/** Normalises typed input: case, dashes/spaces, and the usual confusions (O→0, I/L→1). */
export function normalizeVerifyCode(raw: string): string | null {
  const s = raw
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{12}$/.test(s) ? s : null;
}

export const formatVerifyCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;

// ───────────── eligibility ─────────────

export interface EligibilityRules {
  requireAttendance: boolean;
  countLate: boolean;
  minSessionPercent: number | null;
  requireEvaluation: boolean;
}

export interface EligibilityFacts {
  registrationStatus: string;
  /** Whole-event attendance status (null = never checked in). */
  attendance: string | null;
  /** Number of sessions in the event, and how many this registrant attended (PRESENT / LATE per rules). */
  sessionsTotal: number;
  sessionsAttended: number;
  /** Required evaluation forms (published) and how many of them were answered. */
  evaluationsRequired: number;
  evaluationsDone: number;
}

export interface Eligibility {
  eligible: boolean;
  reasons: string[];
}

/**
 * Whether a registrant qualifies for a PARTICIPANT certificate. Every unmet rule is reported (the
 * desk / participant sees all of them at once). EXCUSED never counts as attended.
 */
export function checkEligibility(rules: EligibilityRules, f: EligibilityFacts): Eligibility {
  const reasons: string[] = [];
  if (f.registrationStatus !== 'CONFIRMED') reasons.push('การลงทะเบียนยังไม่ได้รับการยืนยัน');
  const attendedStatuses = rules.countLate ? ['PRESENT', 'LATE'] : ['PRESENT'];
  if (rules.requireAttendance && !attendedStatuses.includes(f.attendance ?? '')) {
    reasons.push(f.attendance === 'LATE' ? 'มาสายเกินเกณฑ์ที่กำหนด' : 'ไม่มีบันทึกการเข้าร่วมกิจกรรม');
  }
  if (rules.minSessionPercent && f.sessionsTotal > 0) {
    const pct = (f.sessionsAttended / f.sessionsTotal) * 100;
    if (pct + 1e-9 < rules.minSessionPercent) {
      reasons.push(`เข้าร่วม ${f.sessionsAttended}/${f.sessionsTotal} ช่วง (${Math.floor(pct)}%) ต่ำกว่าเกณฑ์ ${rules.minSessionPercent}%`);
    }
  }
  if (rules.requireEvaluation && f.evaluationsDone < f.evaluationsRequired) reasons.push('ยังไม่ได้ตอบแบบประเมินกิจกรรม');
  return { eligible: reasons.length === 0, reasons };
}
