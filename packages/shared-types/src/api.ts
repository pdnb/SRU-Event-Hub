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
}
