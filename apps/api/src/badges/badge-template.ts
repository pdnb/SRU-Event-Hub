/**
 * Badge template model shared by the designer API, the print snapshot and the PDF engine.
 * All geometry is millimetres from the badge's top-left corner.
 */

export type BadgeFieldKind = 'TEXT' | 'QR' | 'BAND';
export type BadgeAlign = 'left' | 'center' | 'right';
export type ColorMatchType = 'PARTICIPANT_TYPE' | 'PERSONNEL_ROLE' | 'ANY';

export interface BadgeFieldSpec {
  kind: BadgeFieldKind;
  content: string | null;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  fontSize: number;
  bold: boolean;
  align: BadgeAlign;
  color: string | null;
  sortOrder: number;
}

export interface BadgeColorRuleSpec {
  matchType: ColorMatchType;
  matchValue: string | null;
  color: string;
  label: string | null;
  sortOrder: number;
}

export interface BadgeTemplateSpec {
  nameTh: string;
  paper: 'A4_SHEET' | 'LABEL';
  widthMm: number;
  heightMm: number;
  backgroundColor: string | null;
  backgroundFileId: string | null;
  fields: BadgeFieldSpec[];
  colorRules: BadgeColorRuleSpec[];
}

/** Placeholders a TEXT / BAND field may use, with the designer's Thai description. */
export const BADGE_PLACEHOLDERS: Record<string, string> = {
  fullName: 'ชื่อ-นามสกุล (รวมคำนำหน้า)',
  prefix: 'คำนำหน้า',
  firstName: 'ชื่อ',
  lastName: 'นามสกุล',
  affiliation: 'หน่วยงาน/คณะ/โรงเรียน',
  program: 'หลักสูตร/สาขา',
  position: 'ตำแหน่ง (บุคลากรของงาน)',
  participantType: 'ประเภทผู้เข้าร่วม / บทบาท',
  label: 'ข้อความจากกฎสี (เช่น VIP, วิทยากร)',
  referenceNo: 'เลขอ้างอิงการลงทะเบียน',
  code: 'รหัสนักศึกษา/บุคลากร',
  groupNo: 'เลขที่กลุ่ม',
  groupName: 'ชื่อกลุ่ม',
  organizationName: 'องค์กรที่ส่งเข้าร่วม',
  eventTitle: 'ชื่อกิจกรรม',
  eventCode: 'รหัสกิจกรรม',
  eventDate: 'วันที่จัดกิจกรรม',
  venue: 'สถานที่',
};

export const PERSONNEL_ROLE_LABEL: Record<string, string> = {
  SPEAKER: 'วิทยากร',
  STAFF: 'เจ้าหน้าที่',
  VIP: 'แขกผู้มีเกียรติ',
  ORGANIZER: 'คณะผู้จัด',
  VOLUNTEER: 'อาสาสมัคร',
  MEDIA: 'สื่อมวลชน',
  OTHER: 'อื่น ๆ',
};

/** Replaces {key} with vars[key]; unknown keys become empty so a badge never shows raw braces. */
export function fillBadgeText(text: string, vars: Record<string, string | null | undefined>): string {
  return text.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '').replace(/[ \t]{2,}/g, ' ').trim();
}

/** First matching rule (by sort order) decides the colour band of a badge. */
export function matchColorRule(rules: BadgeColorRuleSpec[], keys: { participantTypeCode?: string | null; personnelRole?: string | null }) {
  return [...rules]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .find(
      (r) =>
        r.matchType === 'ANY' ||
        (r.matchType === 'PARTICIPANT_TYPE' && !!keys.participantTypeCode && r.matchValue === keys.participantTypeCode) ||
        (r.matchType === 'PERSONNEL_ROLE' && !!keys.personnelRole && r.matchValue === keys.personnelRole),
    );
}

/** Problems a template has that would print badly; checked on save and before printing. */
export function validateTemplate(t: Pick<BadgeTemplateSpec, 'widthMm' | 'heightMm' | 'fields'>): string[] {
  const errors: string[] = [];
  t.fields.forEach((f, i) => {
    const n = `ช่องที่ ${i + 1}`;
    if (f.xMm < 0 || f.yMm < 0 || f.xMm + f.wMm > t.widthMm + 0.01 || f.yMm + f.hMm > t.heightMm + 0.01) errors.push(`${n} อยู่นอกขอบป้าย`);
    if (f.kind === 'QR' && Math.min(f.wMm, f.hMm) < 12) errors.push(`${n}: QR ต้องมีขนาดอย่างน้อย 12 มม. เพื่อให้สแกนได้`);
    if (f.kind !== 'QR' && !f.content?.trim()) errors.push(`${n}: ยังไม่ได้ระบุข้อความ`);
    for (const m of (f.content ?? '').matchAll(/\{(\w+)\}/g)) if (!(m[1]! in BADGE_PLACEHOLDERS)) errors.push(`${n}: ไม่รู้จักตัวแปร {${m[1]}}`);
  });
  return errors;
}

/** A sensible starting layout for a given size: event title, colour band, name, affiliation, QR. */
export function defaultLayout(widthMm: number, heightMm: number): Pick<BadgeTemplateSpec, 'fields' | 'colorRules'> {
  const pad = Math.max(3, Math.round(widthMm * 0.05));
  const inner = widthMm - pad * 2;
  const qr = Math.min(Math.round(heightMm * 0.32), Math.round(inner * 0.5), 34);
  const portrait = heightMm >= widthMm;
  const fields: BadgeFieldSpec[] = portrait
    ? [
        { kind: 'TEXT', content: '{eventTitle}', xMm: pad, yMm: pad, wMm: inner, hMm: heightMm * 0.14, fontSize: 11, bold: true, align: 'center', color: '#1f3a8a', sortOrder: 0 },
        { kind: 'BAND', content: '{label}', xMm: 0, yMm: heightMm * 0.2, wMm: widthMm, hMm: heightMm * 0.09, fontSize: 12, bold: true, align: 'center', color: '#1f3a8a', sortOrder: 1 },
        { kind: 'TEXT', content: '{fullName}', xMm: pad, yMm: heightMm * 0.33, wMm: inner, hMm: heightMm * 0.16, fontSize: 18, bold: true, align: 'center', color: '#111111', sortOrder: 2 },
        { kind: 'TEXT', content: '{affiliation}', xMm: pad, yMm: heightMm * 0.5, wMm: inner, hMm: heightMm * 0.1, fontSize: 11, bold: false, align: 'center', color: '#333333', sortOrder: 3 },
        { kind: 'QR', content: null, xMm: (widthMm - qr) / 2, yMm: heightMm - qr - pad - 5, wMm: qr, hMm: qr, fontSize: 12, bold: false, align: 'center', color: null, sortOrder: 4 },
        { kind: 'TEXT', content: '{referenceNo}', xMm: pad, yMm: heightMm - pad - 4.5, wMm: inner, hMm: 4.5, fontSize: 7, bold: false, align: 'center', color: '#555555', sortOrder: 5 },
      ]
    : [
        { kind: 'BAND', content: '{label}', xMm: 0, yMm: 0, wMm: widthMm, hMm: heightMm * 0.16, fontSize: 10, bold: true, align: 'center', color: '#1f3a8a', sortOrder: 0 },
        { kind: 'TEXT', content: '{fullName}', xMm: pad, yMm: heightMm * 0.24, wMm: widthMm - qr - pad * 3, hMm: heightMm * 0.3, fontSize: 15, bold: true, align: 'left', color: '#111111', sortOrder: 1 },
        { kind: 'TEXT', content: '{affiliation}', xMm: pad, yMm: heightMm * 0.56, wMm: widthMm - qr - pad * 3, hMm: heightMm * 0.18, fontSize: 9, bold: false, align: 'left', color: '#333333', sortOrder: 2 },
        { kind: 'TEXT', content: '{eventTitle}', xMm: pad, yMm: heightMm * 0.78, wMm: widthMm - qr - pad * 3, hMm: heightMm * 0.16, fontSize: 7, bold: false, align: 'left', color: '#555555', sortOrder: 3 },
        { kind: 'QR', content: null, xMm: widthMm - qr - pad, yMm: (heightMm * 1.16 - qr) / 2, wMm: qr, hMm: qr, fontSize: 12, bold: false, align: 'center', color: null, sortOrder: 4 },
      ];
  return {
    fields: fields.map((f) => ({ ...f, xMm: round(f.xMm), yMm: round(f.yMm), wMm: round(f.wMm), hMm: round(f.hMm) })),
    colorRules: [
      { matchType: 'PERSONNEL_ROLE', matchValue: 'SPEAKER', color: '#b91c1c', label: 'วิทยากร', sortOrder: 0 },
      { matchType: 'PERSONNEL_ROLE', matchValue: 'VIP', color: '#a16207', label: 'VIP', sortOrder: 1 },
      { matchType: 'PERSONNEL_ROLE', matchValue: 'STAFF', color: '#047857', label: 'STAFF', sortOrder: 2 },
      { matchType: 'ANY', matchValue: null, color: '#1f3a8a', label: '{participantType}', sortOrder: 9 },
    ],
  };
}

const round = (n: number) => Math.round(n * 10) / 10;
