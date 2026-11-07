import { registerSettingValidator } from '../../common/settings.service';

/**
 * Finance document templates (FIN-1). The real forms used by กองคลัง are still to be confirmed, so
 * the layout lives in `system_settings` and is edited from the settings screen — no code change is
 * needed when the official form arrives. Both the PDF and the Excel export render the same template.
 *
 * Text fields may contain {placeholders}; unknown placeholders are left as typed.
 */

export const BATCH_COLUMN_KEYS = [
  'seq',
  'paymentNo',
  'orderNo',
  'referenceNo',
  'payerName',
  'billing',
  'channel',
  'transferredAt',
  'verifiedAt',
  'incomeCode',
  'amount',
  'receipt',
] as const;
export type BatchColumnKey = (typeof BATCH_COLUMN_KEYS)[number];

export const CASH_COLUMN_KEYS = ['seq', 'paymentNo', 'orderNo', 'referenceNo', 'payerName', 'collectedAt', 'status', 'amount'] as const;
export type CashColumnKey = (typeof CASH_COLUMN_KEYS)[number];

export interface TemplateColumn<K extends string = string> {
  key: K;
  label: string;
  /** Relative width (PDF) ≈ characters (Excel). */
  width: number;
  align?: 'left' | 'center' | 'right';
}

export interface DocumentTemplate<K extends string = string> {
  orientation: 'portrait' | 'landscape';
  /** Centered, bold. */
  titleLines: string[];
  /** Left-aligned lines above the table. */
  infoLines: string[];
  columns: TemplateColumn<K>[];
  totalLabel: string;
  /** Printed under the total, e.g. "({totalText})". */
  footerNotes: string[];
  /** Signature blocks laid out side by side. */
  signatures: string[];
}

export const BATCH_TEMPLATE_KEY = 'finance.remittanceReportTemplate';
export const CASH_TEMPLATE_KEY = 'finance.cashRemittanceTemplate';

/** Interim layout until the official form (FIN-1) is confirmed. */
export const DEFAULT_BATCH_TEMPLATE: DocumentTemplate<BatchColumnKey> = {
  orientation: 'landscape',
  titleLines: ['รายงานการนำส่งเงินรายได้ค่าลงทะเบียนกิจกรรม', '{universityName} — {organizationName}'],
  infoLines: [
    'เลขที่ชุดนำส่ง: {batchNo}    สถานะ: {statusLabel}    ปีงบประมาณ: {fiscalYear}',
    'กิจกรรม: {eventCode} {eventTitle}    วันที่จัด: {eventDate}',
    'บัญชีรับเงิน: {bankAccount}', // FIN-5: no income codes ({incomeCode} still available to custom templates)
    'จัดทำโดย: {createdBy}    วันที่จัดทำ: {createdAt}',
  ],
  columns: [
    { key: 'seq', label: 'ลำดับ', width: 6, align: 'center' },
    { key: 'paymentNo', label: 'เลขที่รายการชำระ', width: 15 },
    { key: 'referenceNo', label: 'เลขอ้างอิงการลงทะเบียน', width: 15 },
    { key: 'payerName', label: 'ชื่อผู้ชำระ', width: 22 },
    { key: 'billing', label: 'ออกใบเสร็จในนาม', width: 24 },
    { key: 'channel', label: 'ช่องทาง', width: 9, align: 'center' },
    { key: 'transferredAt', label: 'วันที่ชำระ', width: 15 },
    { key: 'amount', label: 'จำนวนเงิน (บาท)', width: 12, align: 'right' },
    { key: 'receipt', label: 'เลขที่ใบเสร็จ', width: 14 },
  ],
  totalLabel: 'รวมทั้งสิ้น',
  footerNotes: ['({totalText})', 'จำนวน {itemCount} รายการ'],
  signatures: ['ผู้นำส่ง', 'ผู้ตรวจสอบ', 'ผู้รับเงิน (กองคลัง)'],
};

export const DEFAULT_CASH_TEMPLATE: DocumentTemplate<CashColumnKey> = {
  orientation: 'portrait',
  titleLines: ['ใบนำส่งเงินสดรับชำระค่าลงทะเบียนหน้างาน', '{universityName}'],
  infoLines: [
    'เลขที่กะ: {sessionNo}    สถานะ: {statusLabel}    เลขที่ใบนำส่งเงิน: {remittanceNo}',
    'กิจกรรม: {eventCode} {eventTitle}',
    'ผู้รับเงิน: {cashierName}    เปิดกะ: {openedAt}    ปิดกะ: {closedAt}',
    'ยอดในระบบ: {expectedAmount} บาท    นับได้: {countedAmount} บาท    ส่วนต่าง: {difference} บาท',
  ],
  columns: [
    { key: 'seq', label: 'ลำดับ', width: 6, align: 'center' },
    { key: 'paymentNo', label: 'เลขที่รายการ', width: 17 },
    { key: 'referenceNo', label: 'เลขอ้างอิง', width: 17 },
    { key: 'payerName', label: 'ชื่อผู้ชำระ', width: 28 },
    { key: 'collectedAt', label: 'เวลารับเงิน', width: 18 },
    { key: 'amount', label: 'จำนวนเงิน (บาท)', width: 14, align: 'right' },
  ],
  totalLabel: 'รวมเงินสดที่นำส่ง',
  footerNotes: ['({totalText})', 'หมายเหตุ: {closeNote}'],
  signatures: ['ผู้รับเงิน / ผู้นำส่ง', 'ผู้รับนำส่ง (การเงิน)'],
};

// ───────────── validation ─────────────

const isStrArr = (v: unknown, max: number): v is string[] =>
  Array.isArray(v) && v.length <= max && v.every((s) => typeof s === 'string' && s.length <= 300);

export function templateError(v: unknown, keys: readonly string[]): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'แม่แบบต้องเป็น object';
  const t = v as Record<string, unknown>;
  if (t.orientation !== 'portrait' && t.orientation !== 'landscape') return 'orientation ต้องเป็น portrait หรือ landscape';
  if (!isStrArr(t.titleLines, 5)) return 'titleLines ต้องเป็นรายการข้อความ (ไม่เกิน 5 บรรทัด)';
  if (!isStrArr(t.infoLines, 10)) return 'infoLines ต้องเป็นรายการข้อความ (ไม่เกิน 10 บรรทัด)';
  if (!isStrArr(t.footerNotes, 10)) return 'footerNotes ต้องเป็นรายการข้อความ (ไม่เกิน 10 บรรทัด)';
  if (!isStrArr(t.signatures, 4)) return 'signatures ต้องเป็นรายการข้อความ (ไม่เกิน 4 ช่อง)';
  if (typeof t.totalLabel !== 'string' || t.totalLabel.length > 100) return 'totalLabel ต้องเป็นข้อความ';
  if (!Array.isArray(t.columns) || !t.columns.length || t.columns.length > 14) return 'columns ต้องมี 1–14 คอลัมน์';
  for (const c of t.columns as Record<string, unknown>[]) {
    if (!c || typeof c !== 'object') return 'คอลัมน์ไม่ถูกต้อง';
    if (!keys.includes(c.key as string)) return `คอลัมน์ "${String(c.key)}" ไม่รองรับ (ใช้ได้: ${keys.join(', ')})`;
    if (typeof c.label !== 'string' || c.label.length > 100) return `label ของคอลัมน์ ${String(c.key)} ไม่ถูกต้อง`;
    if (typeof c.width !== 'number' || !(c.width >= 2 && c.width <= 60)) return `width ของคอลัมน์ ${String(c.key)} ต้องอยู่ระหว่าง 2–60`;
    if (c.align !== undefined && !['left', 'center', 'right'].includes(c.align as string)) return `align ของคอลัมน์ ${String(c.key)} ไม่ถูกต้อง`;
  }
  return null;
}

export const isBatchTemplate = (v: unknown): v is DocumentTemplate<BatchColumnKey> => templateError(v, BATCH_COLUMN_KEYS) === null;
export const isCashTemplate = (v: unknown): v is DocumentTemplate<CashColumnKey> => templateError(v, CASH_COLUMN_KEYS) === null;

registerSettingValidator(BATCH_TEMPLATE_KEY, (v) => templateError(v, BATCH_COLUMN_KEYS));
registerSettingValidator(CASH_TEMPLATE_KEY, (v) => templateError(v, CASH_COLUMN_KEYS));

/** "{batchNo}" → vars.batchNo. Unknown placeholders stay visible so a typo is noticed on paper. */
export function fill(text: string, vars: Record<string, string | number | null | undefined>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = vars[k];
    return v === undefined ? m : v === null || v === '' ? '-' : String(v);
  });
}
