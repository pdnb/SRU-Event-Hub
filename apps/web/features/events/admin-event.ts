import type { EventDetailDto } from '@sru/shared-types';
import type { EventFormValues } from './event-form-schema';

/** Shape returned by GET /events/:id (admin). */
export type AdminEventDto = EventDetailDto & {
  version: number;
  ownerUserId: string;
  owner: { id: string; displayName: string };
  eventTypeId: string | null;
  categoryId: string | null;
  isFeatured: boolean;
  paymentWindowHours: number;
  bankAccountId: string | null;
  incomeCodeId: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
};

export function toFormValues(e: AdminEventDto): Partial<EventFormValues> {
  return {
    titleTh: e.titleTh,
    titleEn: e.titleEn ?? '',
    organizationId: e.organizationId,
    eventTypeId: e.eventTypeId,
    categoryId: e.categoryId,
    description: e.description ?? '',
    objectives: e.objectives ?? '',
    targetAudience: e.targetAudience ?? '',
    conditions: e.conditions ?? '',
    eventRange: [e.startAt, e.endAt],
    registrationRange: e.registrationOpenAt && e.registrationCloseAt ? [e.registrationOpenAt, e.registrationCloseAt] : null,
    venueText: e.venueText ?? '',
    capacity: e.capacity,
    minParticipants: e.minParticipants,
    budget: e.budget ?? '',
    allowGuestRegistration: e.allowGuestRegistration,
    allowWaitlist: e.allowWaitlist,
    allowSelfCancel: e.allowSelfCancel,
    isFeatured: e.isFeatured,
    participantTypeIds: e.participantTypes.map((p) => p.id),
    tags: e.tags,
    feeRates: e.feeRates.map((r) => ({
      nameTh: r.nameTh,
      amount: r.amount,
      participantTypeId: r.participantTypeId,
      validRange: r.validFrom || r.validUntil ? [r.validFrom, r.validUntil] : null,
    })),
    paymentWindowHours: e.paymentWindowHours,
    bankAccountId: e.bankAccountId,
    incomeCodeId: e.incomeCodeId,
    registrationFields: e.registrationFields.map((f) => ({
      key: f.key,
      labelTh: f.labelTh,
      fieldType: f.fieldType,
      isRequired: f.isRequired,
      optionsText: f.options.map((o) => o.labelTh).join('\n'),
    })),
  };
}

export const EDITABLE = ['DRAFT', 'REJECTED'];
export const POST_APPROVAL_EDITABLE = ['APPROVED', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS'];
