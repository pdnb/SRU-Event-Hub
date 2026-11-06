/**
 * Group member import (Excel). Pure functions – unit tested.
 *
 * The template's first row holds the column labels; columns are matched by label (a trailing "*"
 * marking required columns is ignored), so coordinators may reorder or drop optional columns.
 * Every row is validated independently and all problems are reported together; nothing is written
 * until the coordinator commits the valid rows.
 */
import type { AnswerDto } from '../registrations/registrations.dto';
import { checkAnswers, type FieldWithOptions } from '../registrations/answers';

export type Cell = string | number | boolean | Date | null | undefined;

export const MAX_IMPORT_ROWS = 1000;

export const CORE_COLUMNS = [
  { key: 'prefix', label: 'คำนำหน้า', required: false },
  { key: 'firstName', label: 'ชื่อ', required: true },
  { key: 'lastName', label: 'นามสกุล', required: true },
  { key: 'email', label: 'อีเมล', required: true },
  { key: 'phone', label: 'โทรศัพท์', required: false },
  { key: 'participantType', label: 'ประเภทผู้เข้าร่วม', required: true },
  { key: 'studentOrStaffCode', label: 'รหัสนักศึกษา/บุคลากร', required: false },
  { key: 'affiliation', label: 'หน่วยงาน/สังกัด', required: false },
  { key: 'program', label: 'หลักสูตร/สาขา/ชั้นเรียน', required: false },
] as const;

export interface ImportSpec {
  fields: FieldWithOptions[];
  participantTypes: { code: string; nameTh: string }[];
}

export interface ParsedMember {
  participantTypeCode: string;
  prefix?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  studentOrStaffCode?: string;
  affiliation?: string;
  program?: string;
  answers: AnswerDto[];
}

export interface ParsedRow {
  rowNo: number;
  /** Raw values by column label (what the user typed) – kept as evidence and for the preview. */
  data: Record<string, string>;
  member: ParsedMember | null;
  errors: Record<string, string> | null;
}

/** Header labels in template order (core columns, then the event's own questions). */
export function templateHeaders(spec: ImportSpec): string[] {
  return [
    ...CORE_COLUMNS.map((c) => (c.required ? `${c.label} *` : c.label)),
    ...spec.fields.map((f) => (f.isRequired ? `${f.labelTh} *` : f.labelTh)),
  ];
}

const norm = (s: unknown) => String(s ?? '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

export function cellText(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  // Excel often stores phone numbers as numbers and drops the leading 0.
  return String(v).trim();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseMemberRows(rows: Cell[][], spec: ImportSpec): { rows: ParsedRow[]; headerErrors: string[] } {
  const header = (rows[0] ?? []).map(norm);
  const col = (label: string) => header.indexOf(norm(label));
  const headerErrors = CORE_COLUMNS.filter((c) => c.required && col(c.label) < 0).map((c) => `ไม่พบคอลัมน์ "${c.label}"`);
  if (headerErrors.length) return { rows: [], headerErrors };

  const typeByKey = new Map<string, string>();
  for (const t of spec.participantTypes) {
    typeByKey.set(norm(t.code), t.code);
    typeByKey.set(norm(t.nameTh), t.code);
  }

  const out: ParsedRow[] = [];
  const seenEmails = new Map<string, number>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const get = (label: string) => {
      const idx = col(label);
      return idx < 0 ? '' : cellText(r[idx]);
    };
    const data: Record<string, string> = {};
    for (const c of CORE_COLUMNS) data[c.label] = get(c.label);
    for (const f of spec.fields) data[f.labelTh] = get(f.labelTh);
    if (Object.values(data).every((v) => !v)) continue; // blank line

    const errors: Record<string, string> = {};
    for (const c of CORE_COLUMNS) if (c.required && !data[c.label]) errors[c.label] = 'จำเป็นต้องกรอก';
    const email = data['อีเมล']!.toLowerCase();
    if (email && !EMAIL.test(email)) errors['อีเมล'] = 'อีเมลไม่ถูกต้อง';
    else if (email && seenEmails.has(email)) errors['อีเมล'] = `ซ้ำกับแถวที่ ${seenEmails.get(email)}`;
    if (email) seenEmails.set(email, i + 1);

    let phone = data['โทรศัพท์']!.replace(/[\s-]/g, '');
    if (/^[1-9]\d{7,8}$/.test(phone)) phone = `0${phone}`;
    if (phone && !/^0\d{8,9}$/.test(phone)) errors['โทรศัพท์'] = 'เบอร์โทรศัพท์ไม่ถูกต้อง';

    const ptRaw = data['ประเภทผู้เข้าร่วม']!;
    const ptCode = typeByKey.get(norm(ptRaw));
    if (ptRaw && !ptCode) errors['ประเภทผู้เข้าร่วม'] = `ไม่รู้จัก (ใช้: ${spec.participantTypes.map((t) => t.nameTh).join(', ')})`;

    for (const [label, max] of [['ชื่อ', 150], ['นามสกุล', 150], ['คำนำหน้า', 50], ['รหัสนักศึกษา/บุคลากร', 30], ['หน่วยงาน/สังกัด', 300], ['หลักสูตร/สาขา/ชั้นเรียน', 300]] as const) {
      if ((data[label]?.length ?? 0) > max) errors[label] = `ยาวเกิน ${max} ตัวอักษร`;
    }

    const answers: AnswerDto[] = spec.fields
      .filter((f) => data[f.labelTh])
      .map((f) => {
        const raw = data[f.labelTh]!;
        const multi = f.fieldType === 'MULTISELECT' || f.fieldType === 'CHECKBOX';
        return { key: f.key, value: multi ? raw.split(/[,،;]/).map((s) => s.trim()).filter(Boolean) : raw };
      });
    const checked = checkAnswers(spec.fields, answers, { requireAll: false });
    for (const [key, msg] of Object.entries(checked.errors)) {
      const f = spec.fields.find((x) => x.key === key);
      errors[f?.labelTh ?? key] = msg;
    }

    const ok = !Object.keys(errors).length;
    out.push({
      rowNo: i + 1,
      data,
      errors: ok ? null : errors,
      member: ok
        ? {
            participantTypeCode: ptCode!,
            prefix: data['คำนำหน้า'] || undefined,
            firstName: data['ชื่อ']!,
            lastName: data['นามสกุล']!,
            email: data['อีเมล']!,
            phone: phone || undefined,
            studentOrStaffCode: data['รหัสนักศึกษา/บุคลากร'] || undefined,
            affiliation: data['หน่วยงาน/สังกัด'] || undefined,
            program: data['หลักสูตร/สาขา/ชั้นเรียน'] || undefined,
            answers,
          }
        : null,
    });
  }
  return { rows: out, headerErrors: [] };
}
