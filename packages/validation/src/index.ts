import { z } from 'zod';

const msg = {
  required: 'กรุณากรอกข้อมูล',
  email: 'รูปแบบอีเมลไม่ถูกต้อง',
  phone: 'เบอร์โทรศัพท์ต้องเป็นตัวเลข 9–10 หลัก',
};

export const moneyString = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, 'จำนวนเงินไม่ถูกต้อง (ทศนิยมไม่เกิน 2 ตำแหน่ง)');

export const thaiPhone = z.string().regex(/^0\d{8,9}$/, msg.phone);

export const loginSchema = z.object({
  username: z.string().trim().min(1, msg.required),
  password: z.string().min(1, msg.required),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const eventBaseSchema = z.object({
  titleTh: z.string().trim().min(3, 'ชื่อกิจกรรมอย่างน้อย 3 ตัวอักษร').max(300),
  titleEn: z.string().trim().max(300).optional().or(z.literal('')),
  organizationId: z.uuid('กรุณาเลือกหน่วยงาน'),
  categoryId: z.uuid().optional().nullable(),
  eventTypeId: z.uuid().optional().nullable(),
  description: z.string().max(20000).optional().nullable(),
  objectives: z.string().max(5000).optional().nullable(),
  targetAudience: z.string().max(2000).optional().nullable(),
  conditions: z.string().max(5000).optional().nullable(),
  startAt: z.iso.datetime({ offset: true }),
  endAt: z.iso.datetime({ offset: true }),
  registrationOpenAt: z.iso.datetime({ offset: true }).optional().nullable(),
  registrationCloseAt: z.iso.datetime({ offset: true }).optional().nullable(),
  venueId: z.uuid().optional().nullable(),
  venueText: z.string().max(500).optional().nullable(),
  capacity: z.number().int().positive().optional().nullable(),
  minParticipants: z.number().int().nonnegative().optional().nullable(),
  budget: moneyString.optional().nullable(),
  allowGuestRegistration: z.boolean().default(false),
  allowWaitlist: z.boolean().default(true),
});

export const eventCreateSchema = eventBaseSchema
  .refine((v) => new Date(v.endAt) > new Date(v.startAt), {
    path: ['endAt'],
    message: 'วันสิ้นสุดต้องอยู่หลังวันเริ่มต้น',
  })
  .refine(
    (v) =>
      !v.registrationOpenAt ||
      !v.registrationCloseAt ||
      new Date(v.registrationCloseAt) > new Date(v.registrationOpenAt),
    { path: ['registrationCloseAt'], message: 'วันปิดรับสมัครต้องอยู่หลังวันเปิดรับสมัคร' },
  );
export type EventCreateInput = z.infer<typeof eventCreateSchema>;

export const registrationSchema = z.object({
  participantTypeCode: z.string().min(1, msg.required),
  prefix: z.string().max(50).optional(),
  firstName: z.string().trim().min(1, msg.required).max(150),
  lastName: z.string().trim().min(1, msg.required).max(150),
  email: z.email(msg.email),
  phone: thaiPhone.optional().or(z.literal('')),
  studentOrStaffCode: z.string().max(30).optional(),
  affiliation: z.string().max(300).optional(),
  program: z.string().max(300).optional(),
  pdpaConsent: z.literal(true, { error: 'กรุณายอมรับนโยบายคุ้มครองข้อมูลส่วนบุคคล' }),
});
export type RegistrationInput = z.infer<typeof registrationSchema>;
