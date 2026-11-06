export type FieldKind = 'TEXT' | 'QR' | 'BAND';
export type Align = 'left' | 'center' | 'right';

export interface BadgeField {
  kind: FieldKind;
  content: string | null;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  fontSize: number;
  bold: boolean;
  align: Align;
  color: string | null;
}

export interface ColorRule {
  matchType: 'PARTICIPANT_TYPE' | 'PERSONNEL_ROLE' | 'ANY';
  matchValue: string | null;
  color: string;
  label: string | null;
}

export interface BadgeTemplate {
  id: string;
  eventId: string;
  nameTh: string;
  paper: 'A4_SHEET' | 'LABEL';
  widthMm: number;
  heightMm: number;
  backgroundColor: string | null;
  backgroundFileId: string | null;
  isDefault: boolean;
  version: number;
  perSheet: number;
  fields: BadgeField[];
  colorRules: ColorRule[];
}

export interface TemplateSummary {
  id: string;
  nameTh: string;
  paper: 'A4_SHEET' | 'LABEL';
  widthMm: number;
  heightMm: number;
  isDefault: boolean;
  fieldCount: number;
  jobCount: number;
  perSheet: number;
  updatedAt: string;
}

export interface Candidate {
  kind: 'registration' | 'personnel';
  id: string;
  referenceNo?: string;
  fullName: string;
  detail: string;
  affiliation: string | null;
  groupNo?: string | null;
  printCount: number;
  lastPrintedAt: string | null;
  checkedIn: boolean | null;
}

export interface PrintJob {
  id: string;
  mode: 'BATCH' | 'INSTANT' | 'REPRINT';
  itemCount: number;
  reason: string | null;
  downloadCount: number;
  lastDownloadedAt: string | null;
  createdAt: string;
  template: { nameTh: string };
  requestedBy: { displayName: string };
}

export interface Personnel {
  id: string;
  role: string;
  userId: string | null;
  prefix: string | null;
  firstName: string;
  lastName: string;
  position: string | null;
  affiliation: string | null;
  email: string | null;
  phone: string | null;
  canCheckin: boolean;
  badgePrints: number;
  user: { id: string; displayName: string; email: string } | null;
}

export const MODE_LABEL: Record<string, { text: string; color: string }> = {
  BATCH: { text: 'พิมพ์ชุด', color: 'blue' },
  INSTANT: { text: 'พิมพ์ทันที', color: 'green' },
  REPRINT: { text: 'พิมพ์ซ้ำ', color: 'orange' },
};

export const ROLE_LABEL: Record<string, string> = {
  SPEAKER: 'วิทยากร',
  STAFF: 'เจ้าหน้าที่',
  VIP: 'แขกผู้มีเกียรติ',
  ORGANIZER: 'คณะผู้จัด',
  VOLUNTEER: 'อาสาสมัคร',
  MEDIA: 'สื่อมวลชน',
  OTHER: 'อื่น ๆ',
};

/** Common badge sizes (mm). */
export const SIZE_PRESETS = [
  { key: 'hang', label: 'ป้ายห้อยคอ 90×120 มม. (A4 ได้ 4 ป้าย)', widthMm: 90, heightMm: 120, paper: 'A4_SHEET' as const },
  { key: 'a6', label: 'ป้ายห้อยคอใหญ่ 100×140 มม. (A4 ได้ 2 ป้าย)', widthMm: 100, heightMm: 140, paper: 'A4_SHEET' as const },
  { key: 'card', label: 'นามบัตร 90×55 มม. (A4 ได้ 9 ป้าย)', widthMm: 90, heightMm: 55, paper: 'A4_SHEET' as const },
  { key: 'cr80', label: 'บัตร PVC 86×54 มม. (เครื่องพิมพ์บัตร)', widthMm: 86, heightMm: 54, paper: 'LABEL' as const },
  { key: 'label', label: 'สติกเกอร์ฉลาก 100×60 มม. (เครื่องพิมพ์ฉลาก)', widthMm: 100, heightMm: 60, paper: 'LABEL' as const },
];
