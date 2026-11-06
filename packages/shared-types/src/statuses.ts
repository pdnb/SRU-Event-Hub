/**
 * Status enums. Values mirror the Prisma enums 1:1 (apps/api/prisma/schema).
 * Event, approval, registration and payment statuses are deliberately separate
 * (spec §4.3, §4.7.7).
 */

export const EventStatus = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PUBLISHED: 'PUBLISHED',
  REGISTRATION_OPEN: 'REGISTRATION_OPEN',
  REGISTRATION_CLOSED: 'REGISTRATION_CLOSED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type EventStatus = (typeof EventStatus)[keyof typeof EventStatus];

export const ApprovalStatus = {
  NOT_SUBMITTED: 'NOT_SUBMITTED',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  RETURNED: 'RETURNED',
  CANCELLED: 'CANCELLED',
} as const;
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

export const RegistrationStatus = {
  /** Group member not yet submitted by the coordinator (holds no seat). */
  DRAFT: 'DRAFT',
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  CONFIRMED: 'CONFIRMED',
  WAITLISTED: 'WAITLISTED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const;
export type RegistrationStatus = (typeof RegistrationStatus)[keyof typeof RegistrationStatus];

/** Registration group (P3). Mirrors Prisma RegistrationGroupStatus. */
export const GroupStatus = {
  DRAFT: 'DRAFT',
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const;
export type GroupStatus = (typeof GroupStatus)[keyof typeof GroupStatus];

export const PaymentOrderStatus = {
  UNPAID: 'UNPAID',
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  PAID: 'PAID',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  WAIVED: 'WAIVED',
  REFUND_PENDING: 'REFUND_PENDING',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentOrderStatus = (typeof PaymentOrderStatus)[keyof typeof PaymentOrderStatus];

export const PaymentStatus = {
  SUBMITTED: 'SUBMITTED',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
  VOIDED: 'VOIDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const ReceiptStatus = {
  ISSUED: 'ISSUED',
  DELIVERED: 'DELIVERED',
  VOIDED: 'VOIDED',
  RETURNED_UNUSED: 'RETURNED_UNUSED',
} as const;
export type ReceiptStatus = (typeof ReceiptStatus)[keyof typeof ReceiptStatus];

export const FinanceBatchStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  RETURNED: 'RETURNED',
  RECEIVED: 'RECEIVED',
  RECEIPTS_ISSUED: 'RECEIPTS_ISSUED',
  CLOSED: 'CLOSED',
} as const;
export type FinanceBatchStatus = (typeof FinanceBatchStatus)[keyof typeof FinanceBatchStatus];

export const CashierSessionStatus = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
  REMITTED: 'REMITTED',
  CONFIRMED: 'CONFIRMED',
} as const;
export type CashierSessionStatus =
  (typeof CashierSessionStatus)[keyof typeof CashierSessionStatus];

export const PaymentChannel = {
  TRANSFER: 'TRANSFER',
  ONSITE: 'ONSITE',
} as const;
export type PaymentChannel = (typeof PaymentChannel)[keyof typeof PaymentChannel];

/** Thai labels + AntD Tag colours, shared so every screen renders statuses identically. */
export const STATUS_META: Record<string, { label: string; color: string }> = {
  // event
  DRAFT: { label: 'ฉบับร่าง', color: 'default' },
  PENDING_APPROVAL: { label: 'รออนุมัติ', color: 'gold' },
  APPROVED: { label: 'อนุมัติแล้ว', color: 'green' },
  REJECTED: { label: 'ไม่อนุมัติ', color: 'red' },
  PUBLISHED: { label: 'เผยแพร่แล้ว', color: 'blue' },
  REGISTRATION_OPEN: { label: 'เปิดรับสมัคร', color: 'cyan' },
  REGISTRATION_CLOSED: { label: 'ปิดรับสมัคร', color: 'purple' },
  IN_PROGRESS: { label: 'กำลังดำเนินการ', color: 'processing' },
  COMPLETED: { label: 'เสร็จสิ้น', color: 'success' },
  CANCELLED: { label: 'ยกเลิก', color: 'red' },
  // approval
  NOT_SUBMITTED: { label: 'ยังไม่เสนอ', color: 'default' },
  PENDING: { label: 'รอพิจารณา', color: 'gold' },
  RETURNED: { label: 'ส่งกลับแก้ไข', color: 'orange' },
  // registration
  PENDING_PAYMENT: { label: 'รอชำระเงิน', color: 'gold' },
  CONFIRMED: { label: 'ยืนยันแล้ว', color: 'green' },
  WAITLISTED: { label: 'รายชื่อสำรอง', color: 'purple' },
  EXPIRED: { label: 'หมดเวลาชำระ', color: 'default' },
  // group
  SUBMITTED: { label: 'ส่งแล้ว', color: 'blue' },
  PARTIALLY_CONFIRMED: { label: 'ยืนยันบางส่วน', color: 'orange' },
  // payment order
  UNPAID: { label: 'ยังไม่ชำระ', color: 'gold' },
  PENDING_VERIFICATION: { label: 'รอตรวจสอบ', color: 'processing' },
  PAID: { label: 'ชำระแล้ว', color: 'green' },
  WAIVED: { label: 'ยกเว้นค่าธรรมเนียม', color: 'cyan' },
  REFUND_PENDING: { label: 'รอคืนเงิน', color: 'orange' },
  PARTIALLY_REFUNDED: { label: 'คืนเงินบางส่วน', color: 'orange' },
  REFUNDED: { label: 'คืนเงินแล้ว', color: 'default' },
  // payment
  VERIFIED: { label: 'ตรวจสอบแล้ว', color: 'green' },
  VOIDED: { label: 'ยกเลิกรายการ', color: 'default' },
  // receipt
  ISSUED: { label: 'ออกแล้ว', color: 'blue' },
  DELIVERED: { label: 'ส่งมอบแล้ว', color: 'green' },
  RETURNED_UNUSED: { label: 'คืนกองคลัง', color: 'default' },
  // batch / cashier
  RECEIVED: { label: 'กองคลังรับแล้ว', color: 'blue' },
  RECEIPTS_ISSUED: { label: 'ออกใบเสร็จแล้ว', color: 'cyan' },
  CLOSED: { label: 'ปิดแล้ว', color: 'default' },
  OPEN: { label: 'เปิดกะ', color: 'green' },
  REMITTED: { label: 'นำส่งแล้ว', color: 'blue' },
  // refund
  REQUESTED: { label: 'รอพิจารณา', color: 'gold' },
  // bank-statement reconciliation
  UNMATCHED: { label: 'ยังไม่พบรายการ', color: 'red' },
  AUTO: { label: 'จับคู่อัตโนมัติ', color: 'green' },
  MANUAL: { label: 'จับคู่โดยเจ้าหน้าที่', color: 'cyan' },
  IGNORED: { label: 'ไม่เกี่ยวข้อง', color: 'default' },
};

/** Context-specific labels where the same code means different things (e.g. SUBMITTED). */
export const STATUS_META_BY_KIND: Record<string, Record<string, { label: string; color: string }>> = {
  payment: { SUBMITTED: { label: 'รอตรวจสอบ', color: 'processing' } },
  refund: { PAID: { label: 'คืนเงินแล้ว', color: 'green' }, APPROVED: { label: 'อนุมัติแล้ว รอจ่ายคืน', color: 'cyan' } },
  cashier: { CLOSED: { label: 'ปิดกะแล้ว', color: 'orange' }, CONFIRMED: { label: 'ยืนยันยอดแล้ว', color: 'green' } },
  registration: { DRAFT: { label: 'ร่าง (ยังไม่ส่งกลุ่ม)', color: 'default' } },
  group: { DRAFT: { label: 'กำลังรวบรวมรายชื่อ', color: 'default' }, EXPIRED: { label: 'หมดเวลาชำระ', color: 'default' } },
  import: { VALIDATED: { label: 'ตรวจสอบแล้ว รอนำเข้า', color: 'gold' }, COMMITTED: { label: 'นำเข้าแล้ว', color: 'green' }, DISCARDED: { label: 'ยกเลิก', color: 'default' } },
  batch: { SUBMITTED: { label: 'ส่งกองคลังแล้ว', color: 'blue' } },
};
