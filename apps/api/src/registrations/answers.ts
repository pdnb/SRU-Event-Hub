import { Errors } from '../common/errors';
import { Prisma } from '../generated/prisma/client';
import type { AnswerDto } from './registrations.dto';

export type FieldWithOptions = Prisma.RegistrationFieldGetPayload<{ include: { options: true } }>;

/**
 * Validates answers to the organizer's extra registration questions and maps them to rows.
 * `requireAll: false` skips the "required" check (group members may be completed later; the group
 * is validated strictly on submit).
 */
export function validateAnswers(
  fields: FieldWithOptions[],
  answers: AnswerDto[],
  opts: { requireAll?: boolean } = {},
): Prisma.RegistrationAnswerCreateWithoutRegistrationInput[] {
  const { errors, out } = checkAnswers(fields, answers, opts);
  if (Object.keys(errors).length) throw Errors.validation('ข้อมูลแบบฟอร์มไม่ถูกต้อง', errors);
  return out;
}

/** Same as validateAnswers but returns the errors instead of throwing (Excel import). */
export function checkAnswers(fields: FieldWithOptions[], answers: AnswerDto[], opts: { requireAll?: boolean } = {}) {
  const requireAll = opts.requireAll ?? true;
  const byKey = new Map(answers.map((a) => [a.key, a.value]));
  const errors: Record<string, string> = {};
  const out: Prisma.RegistrationAnswerCreateWithoutRegistrationInput[] = [];

  for (const f of fields) {
    const raw = byKey.get(f.key);
    const values = (Array.isArray(raw) ? raw : raw == null || raw === '' ? [] : [raw]).map((v) => String(v).trim()).filter(Boolean);
    if (!values.length) {
      if (f.isRequired && requireAll) errors[f.key] = `กรุณากรอก ${f.labelTh}`;
      continue;
    }
    const multi = f.fieldType === 'MULTISELECT' || f.fieldType === 'CHECKBOX';
    if (!multi && values.length > 1) {
      errors[f.key] = 'เลือกได้เพียงค่าเดียว';
      continue;
    }
    if (f.options.length) {
      for (const v of values) {
        const opt = f.options.find((o) => o.value === v || o.labelTh === v);
        if (!opt) errors[f.key] = 'ตัวเลือกไม่ถูกต้อง';
        else out.push({ field: { connect: { id: f.id } }, option: { connect: { id: opt.id } } });
      }
      continue;
    }
    const v = values[0]!;
    const max = f.maxLength ?? (f.fieldType === 'TEXTAREA' ? 5000 : 500);
    if (v.length > max) errors[f.key] = `ยาวเกิน ${max} ตัวอักษร`;
    else if (f.fieldType === 'NUMBER' && !/^-?\d+(\.\d+)?$/.test(v)) errors[f.key] = 'ต้องเป็นตัวเลข';
    else if (f.fieldType === 'EMAIL' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errors[f.key] = 'อีเมลไม่ถูกต้อง';
    else if (f.fieldType === 'PHONE' && !/^0\d{8,9}$/.test(v)) errors[f.key] = 'เบอร์โทรศัพท์ไม่ถูกต้อง';
    else if (f.fieldType === 'DATE' && Number.isNaN(Date.parse(v))) errors[f.key] = 'วันที่ไม่ถูกต้อง';
    else out.push({ field: { connect: { id: f.id } }, valueText: v });
  }
  const unknown = answers.filter((a) => !fields.some((f) => f.key === a.key)).map((a) => a.key);
  if (unknown.length) errors._unknown = `ไม่รู้จักฟิลด์: ${unknown.join(', ')}`;
  return { errors, out };
}

/** Which required questions a stored member has not answered yet. */
export function missingRequired(fields: FieldWithOptions[], answeredFieldIds: Set<string>): string[] {
  return fields.filter((f) => f.isRequired && !answeredFieldIds.has(f.id)).map((f) => f.labelTh);
}
