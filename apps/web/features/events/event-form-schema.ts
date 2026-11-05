import { z } from 'zod';
import { moneyString } from '@sru/validation';

const fieldTypes = ['TEXT', 'TEXTAREA', 'NUMBER', 'EMAIL', 'PHONE', 'DATE', 'SELECT', 'MULTISELECT', 'RADIO', 'CHECKBOX'] as const;
export const OPTION_TYPES = new Set(['SELECT', 'MULTISELECT', 'RADIO', 'CHECKBOX']);

export const eventFormSchema = z
  .object({
    titleTh: z.string().trim().min(3, 'ชื่อกิจกรรมอย่างน้อย 3 ตัวอักษร').max(300),
    titleEn: z.string().trim().max(300).optional(),
    organizationId: z.string({ error: 'กรุณาเลือกหน่วยงาน' }).uuid('กรุณาเลือกหน่วยงาน'),
    eventTypeId: z.string().uuid().nullish(),
    categoryId: z.string().uuid().nullish(),
    description: z.string().max(20000).optional(),
    objectives: z.string().max(5000).optional(),
    targetAudience: z.string().max(2000).optional(),
    conditions: z.string().max(5000).optional(),
    eventRange: z.tuple([z.string(), z.string()], { error: 'กรุณาระบุวันเวลาจัดกิจกรรม' }),
    registrationRange: z.tuple([z.string(), z.string()]).nullish(),
    venueText: z.string().max(500).optional(),
    capacity: z.number().int().positive('ต้องมากกว่า 0').nullish(),
    minParticipants: z.number().int().nonnegative().nullish(),
    budget: moneyString.or(z.literal('')).nullish(),
    allowGuestRegistration: z.boolean(),
    allowWaitlist: z.boolean(),
    allowSelfCancel: z.boolean(),
    isFeatured: z.boolean(),
    participantTypeIds: z.array(z.string()),
    tags: z.array(z.string().max(100)).max(30),
    feeRates: z.array(
      z.object({
        nameTh: z.string().trim().min(1, 'กรุณาระบุชื่ออัตรา').max(200),
        amount: moneyString,
        participantTypeId: z.string().uuid().nullish(),
        validRange: z.tuple([z.string().nullable(), z.string().nullable()]).nullish(),
      }),
    ),
    paymentWindowHours: z.number().int().min(1, 'อย่างน้อย 1 ชั่วโมง').max(720, 'ไม่เกิน 720 ชั่วโมง'),
    bankAccountId: z.string().uuid().nullish(),
    incomeCodeId: z.string().uuid().nullish(),
    registrationFields: z.array(
      z
        .object({
          key: z.string().regex(/^[a-z][a-z0-9_]{0,49}$/, 'ใช้ a-z, 0-9, _ ขึ้นต้นด้วยตัวอักษร'),
          labelTh: z.string().trim().min(1, 'กรุณาระบุคำถาม').max(300),
          fieldType: z.enum(fieldTypes),
          isRequired: z.boolean(),
          optionsText: z.string().optional(),
        })
        .refine((f) => !OPTION_TYPES.has(f.fieldType) || (f.optionsText ?? '').trim().length > 0, {
          path: ['optionsText'],
          message: 'กรุณาระบุตัวเลือก (บรรทัดละ 1 ตัวเลือก)',
        }),
    ),
  })
  .refine((v) => !v.feeRates.some((r) => Number(r.amount) > 0) || !!v.bankAccountId, {
    path: ['bankAccountId'],
    message: 'กิจกรรมที่มีค่าลงทะเบียนต้องระบุบัญชีรับเงิน',
  })
  .refine((v) => new Date(v.eventRange[1]) > new Date(v.eventRange[0]), { path: ['eventRange'], message: 'วันสิ้นสุดต้องอยู่หลังวันเริ่มต้น' })
  .refine((v) => !v.registrationRange || new Date(v.registrationRange[1]) <= new Date(v.eventRange[1]), {
    path: ['registrationRange'],
    message: 'วันปิดรับสมัครต้องไม่เกินวันสิ้นสุดกิจกรรม',
  });

export type EventFormValues = z.infer<typeof eventFormSchema>;

/** FNV-1a 32-bit — deterministic short id for an option label. */
function fnv1a(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * "M\nL\nXL" → options. Values are derived from the label, so reordering or
 * inserting options never re-maps answers already given.
 */
export function parseOptions(text: string | undefined) {
  return [...new Set((text ?? '').split('\n').map((l) => l.trim()).filter(Boolean))].map((labelTh) => ({
    value: `o_${fnv1a(labelTh)}`,
    labelTh,
  }));
}

export function toPayload(v: EventFormValues) {
  return {
    titleTh: v.titleTh,
    titleEn: v.titleEn || undefined,
    organizationId: v.organizationId,
    eventTypeId: v.eventTypeId ?? null,
    categoryId: v.categoryId ?? null,
    description: v.description || undefined,
    objectives: v.objectives || undefined,
    targetAudience: v.targetAudience || undefined,
    conditions: v.conditions || undefined,
    startAt: v.eventRange[0],
    endAt: v.eventRange[1],
    registrationOpenAt: v.registrationRange?.[0] ?? null,
    registrationCloseAt: v.registrationRange?.[1] ?? null,
    venueText: v.venueText || null,
    capacity: v.capacity ?? null,
    minParticipants: v.minParticipants ?? null,
    budget: v.budget || null,
    allowGuestRegistration: v.allowGuestRegistration,
    allowWaitlist: v.allowWaitlist,
    allowSelfCancel: v.allowSelfCancel,
    isFeatured: v.isFeatured,
    participantTypeIds: v.participantTypeIds,
    tags: v.tags,
    feeRates: v.feeRates.map((r) => ({
      nameTh: r.nameTh,
      amount: r.amount,
      participantTypeId: r.participantTypeId ?? null,
      validFrom: r.validRange?.[0] ?? null,
      validUntil: r.validRange?.[1] ?? null,
    })),
    paymentWindowHours: v.paymentWindowHours,
    bankAccountId: v.bankAccountId ?? null,
    incomeCodeId: v.incomeCodeId ?? null,
    registrationFields: v.registrationFields.map((f) => ({
      key: f.key,
      labelTh: f.labelTh,
      fieldType: f.fieldType,
      isRequired: f.isRequired,
      ...(OPTION_TYPES.has(f.fieldType) ? { options: parseOptions(f.optionsText) } : {}),
    })),
  };
}
