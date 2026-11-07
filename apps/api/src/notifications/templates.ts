/**
 * Default notification texts (Thai). An active row in `notification_templates` with the same code
 * and channel overrides them (editable at /admin/settings → การแจ้งเตือน).
 *   IN_APP: subject = title, body = short text
 *   EMAIL:  subject + plain-text body (link appended)
 *   LINE:   body only (link appended)
 * Placeholders: {name} {eventTitle} {eventCode} {eventDate} {venue} {referenceNo} {reason} {link} …
 */
export interface TemplateText {
  title: string;
  body: string;
  emailSubject?: string;
  emailBody?: string;
}

export const DEFAULT_TEMPLATES: Record<string, TemplateText> = {
  REGISTRATION_CONFIRMED: {
    title: 'ลงทะเบียนสำเร็จ: {eventTitle}',
    body: 'การลงทะเบียน {referenceNo} ได้รับการยืนยันแล้ว กิจกรรมจัดวันที่ {eventDate} ณ {venue}',
    emailBody: 'เรียน {name}\n\nการลงทะเบียนเข้าร่วม "{eventTitle}" ได้รับการยืนยันแล้ว\nเลขอ้างอิง: {referenceNo}\nวันเวลา: {eventDate}\nสถานที่: {venue}\n\nกรุณาแสดง QR สำหรับเช็กอินที่หน้างาน',
  },
  REGISTRATION_PENDING_PAYMENT: {
    title: 'รอชำระค่าลงทะเบียน: {eventTitle}',
    body: 'การลงทะเบียน {referenceNo} จะได้รับการยืนยันเมื่อชำระเงินภายใน {dueAt}',
    emailBody: 'เรียน {name}\n\nท่านได้สำรองที่นั่ง "{eventTitle}" (เลขอ้างอิง {referenceNo})\nกรุณาชำระค่าลงทะเบียนภายใน {dueAt} มิฉะนั้นที่นั่งจะถูกยกเลิกอัตโนมัติ',
  },
  REGISTRATION_WAITLISTED: {
    title: 'อยู่ในรายชื่อสำรอง: {eventTitle}',
    body: 'ที่นั่งเต็ม ท่านอยู่ในรายชื่อสำรอง ({referenceNo}) ระบบจะแจ้งเมื่อได้รับสิทธิ์',
  },
  WAITLIST_PROMOTED: {
    title: 'ได้รับสิทธิ์เข้าร่วม: {eventTitle}',
    body: 'มีที่นั่งว่าง ท่านได้รับสิทธิ์จากรายชื่อสำรองแล้ว ({referenceNo}) {extra}',
  },
  PAYMENT_VERIFIED: {
    title: 'ชำระเงินเรียบร้อย: {eventTitle}',
    body: 'ตรวจสอบการชำระเงิน {amount} บาท เรียบร้อยแล้ว ({referenceNo})',
  },
  PAYMENT_REJECTED: {
    title: 'หลักฐานการชำระเงินไม่ผ่าน: {eventTitle}',
    body: 'หลักฐานการชำระเงินของ {referenceNo} ไม่ผ่านการตรวจสอบ: {reason} — กรุณาส่งใหม่ภายใน {dueAt}',
  },
  EVENT_CANCELLED: {
    title: 'กิจกรรมถูกยกเลิก: {eventTitle}',
    body: 'กิจกรรมที่ท่านลงทะเบียน ({referenceNo}) ถูกยกเลิก: {reason} — หากชำระเงินแล้ว จะได้รับการติดต่อเรื่องการคืนเงิน',
  },
  EVENT_RESCHEDULED: {
    title: 'เลื่อนกำหนดการ: {eventTitle}',
    body: 'กิจกรรมเปลี่ยนเป็นวันที่ {eventDate} ณ {venue} เหตุผล: {reason}',
  },
  EVENT_REMINDER: {
    title: 'พรุ่งนี้: {eventTitle}',
    body: 'อย่าลืมกิจกรรม "{eventTitle}" วันที่ {eventDate} ณ {venue} — เตรียม QR สำหรับเช็กอิน ({referenceNo})',
  },
  APPROVAL_PENDING: {
    title: 'รอพิจารณาอนุมัติ: {eventTitle}',
    body: 'กิจกรรม {eventCode} รอการพิจารณาของท่านในขั้น "{step}"',
  },
  APPROVAL_DECIDED: {
    title: 'ผลการพิจารณา: {eventTitle}',
    body: 'กิจกรรม {eventCode} {decision} {reason}',
  },
  BOOKING_PENDING: {
    title: 'คำขอจอง{kind}: {resourceName}',
    body: '{requester} ขอจอง{kind} {resourceName} {when} {purpose}',
  },
  BOOKING_DECIDED: {
    title: 'ผลการจอง{kind}: {resourceName}',
    body: 'คำขอจอง {resourceName} {when} {decision} {reason}',
  },
  CERTIFICATE_ISSUED: {
    title: 'เกียรติบัตร: {eventTitle}',
    body: 'เกียรติบัตรเลขที่ {certificateNo} พร้อมดาวน์โหลดแล้ว',
  },
  CASH_REMIT_OVERDUE: {
    title: 'เกินกำหนดนำส่งเงินสด: กะ {sessionNo}',
    body: 'เงินสดที่รับหน้างานของ {eventCode} {eventTitle} จำนวน {amount} บาท ยังไม่ได้บันทึกการนำส่ง (กำหนดนำส่งภายใน {dueAt}) กรุณานำส่งกองคลังและบันทึกเลขที่ใบนำส่งเงิน',
  },
  EVALUATION_OPEN: {
    title: 'แบบประเมิน: {eventTitle}',
    body: 'ขอเชิญตอบ "{formTitle}" {extra}',
  },
};

/** Replaces {key}; unknown keys become empty; collapses doubled spaces. */
export function renderText(text: string, vars: Record<string, string | number | null | undefined>): string {
  return text
    .replace(/\{(\w+)\}/g, (_m, k: string) => (vars[k] == null ? '' : String(vars[k])))
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
