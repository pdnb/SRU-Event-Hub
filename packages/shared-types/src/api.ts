/** Standard response envelope (spec §8). */
export interface PageMeta {
  page: number;
  perPage: number;
  total: number;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: PageMeta;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiErrorBody;

/** Money on the wire is always a 2-decimal string, e.g. "1500.00". */
export type MoneyString = string;

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  roles: { code: string; organizationId: string | null; scope: string }[];
  permissions: string[];
}

export interface OrganizationDto {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string | null;
  type: string;
  parentId: string | null;
  isActive: boolean;
  isFinanceDivision: boolean;
  children?: OrganizationDto[];
}

export interface EventSummaryDto {
  id: string;
  code: string;
  titleTh: string;
  titleEn: string | null;
  status: string;
  approvalStatus: string;
  organizationId: string;
  organizationName: string;
  categoryName: string | null;
  eventTypeName: string | null;
  startAt: string;
  endAt: string;
  registrationOpenAt: string | null;
  registrationCloseAt: string | null;
  venueText: string | null;
  capacity: number | null;
  seatsTaken: number;
  /** Computed: registrations are accepted right now. */
  registrationOpen: boolean;
  isPaid: boolean;
  minFee: MoneyString | null;
  coverImageUrl: string | null;
}

export interface EventDetailDto extends EventSummaryDto {
  description: string | null;
  objectives: string | null;
  targetAudience: string | null;
  conditions: string | null;
  minParticipants: number | null;
  budget: MoneyString | null;
  allowGuestRegistration: boolean;
  allowWaitlist: boolean;
  participantTypes: { id: string; code: string; nameTh: string }[];
  allowSelfCancel: boolean;
  /** Organizer-defined extra questions for the registration form. */
  registrationFields: RegistrationFieldDto[];
  /** Active fee rates (public view). Empty for free events. */
  feeRates: FeeRateDto[];
}

export interface FeeRateDto {
  id: string;
  nameTh: string;
  amount: MoneyString;
  participantTypeId: string | null;
  participantTypeName: string | null;
  validFrom: string | null;
  validUntil: string | null;
}

export interface RegistrationFieldDto {
  key: string;
  labelTh: string;
  fieldType: 'TEXT' | 'TEXTAREA' | 'NUMBER' | 'EMAIL' | 'PHONE' | 'DATE' | 'SELECT' | 'MULTISELECT' | 'RADIO' | 'CHECKBOX';
  isRequired: boolean;
  helpText: string | null;
  maxLength: number | null;
  options: { value: string; labelTh: string }[];
}

export interface RegistrationDto {
  id: string;
  eventId: string;
  referenceNo: string;
  status: string;
  fullName: string;
  email: string;
  phone: string | null;
  participantTypeCode: string;
  createdAt: string;
  waitlistPosition: number | null;
  /** Present when the registration has a live payment order. */
  payment?: PaymentOrderDto | null;
}

/** Receiving account as printed on the payment order (snapshot). */
export interface BankAccountSnapshot {
  bankName: string;
  branch: string | null;
  accountNo: string;
  accountName: string;
  promptPayId: string | null;
}

export interface PaymentOrderDto {
  id: string;
  orderNo: string;
  status: string;
  amount: MoneyString;
  /** Thai baht text, e.g. "หนึ่งพันห้าร้อยบาทถ้วน". */
  amountText: string;
  feeName: string;
  dueAt: string;
  paidAt: string | null;
  bankAccount: BankAccountSnapshot | null;
  /** EMVCo PromptPay payload with the exact amount (render as QR). null when no PromptPay id. */
  promptPayPayload: string | null;
  /** Latest payment attempt (slip) on this order. */
  latestPayment: PaymentDto | null;
}

export interface PaymentDto {
  id: string;
  paymentNo: string;
  channel: string;
  status: string;
  amount: MoneyString;
  transferredAt: string | null;
  submittedAt: string;
  verifiedAt: string | null;
  rejectReason: string | null;
  hasSlip: boolean;
}

/** Finance-side row: payment + order + registrant + event context. */
export interface FinancePaymentRowDto extends PaymentDto {
  orderId: string;
  orderNo: string;
  orderStatus: string;
  payerName: string;
  payerEmail: string;
  registrationId: string | null;
  referenceNo: string | null;
  eventId: string;
  eventCode: string;
  eventTitle: string;
  verifiedByName: string | null;
  batchNo: string | null;
  receiptNo: string | null;
}

export interface FinanceBatchDto {
  id: string;
  batchNo: string;
  status: string;
  eventId: string;
  eventCode: string;
  eventTitle: string;
  organizationId: string;
  organizationName: string;
  totalAmount: MoneyString;
  totalAmountText: string;
  itemCount: number;
  receiptCount: number;
  note: string | null;
  createdByName: string;
  createdAt: string;
  submittedAt: string | null;
  receivedAt: string | null;
  receivedByName: string | null;
  returnedAt: string | null;
  returnReason: string | null;
}
