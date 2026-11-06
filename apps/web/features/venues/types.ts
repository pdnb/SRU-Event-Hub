export type VenueType = 'MEETING_ROOM' | 'LAB' | 'AUDITORIUM' | 'CLASSROOM' | 'OUTDOOR' | 'OTHER';
export type BookingStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface Venue {
  id: string;
  code: string;
  nameTh: string;
  venueType: VenueType;
  capacity: number | null;
  floor: string | null;
  description: string | null;
  buildingId: string | null;
  organizationId: string | null;
  autoApprove: boolean;
  isActive: boolean;
  building?: { id: string; code: string; nameTh: string } | null;
  organization?: { id: string; nameTh: string } | null;
}

export interface Resource {
  id: string;
  code: string;
  nameTh: string;
  resourceType: string;
  quantity: number;
  description: string | null;
  venueId: string | null;
  organizationId: string | null;
  isActive: boolean;
  venue?: { id: string; code: string; nameTh: string } | null;
  organization?: { id: string; nameTh: string } | null;
}

export interface Building {
  id: string;
  code: string;
  nameTh: string;
  campus: string | null;
  address: string | null;
  isActive: boolean;
  _count?: { venues: number };
}

export interface Booking {
  id: string;
  status: BookingStatus;
  startAt: string;
  endAt: string;
  purpose: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  quantity?: number;
  venue?: { id: string; code: string; nameTh: string; capacity: number | null };
  resource?: { id: string; code: string; nameTh: string; quantity: number; resourceType: string };
  event: { id: string; code: string; titleTh: string } | null;
  requestedBy: { displayName: string } | null;
  decidedBy: { displayName: string } | null;
}

export interface AvailabilityRow extends Venue {
  free: boolean;
  pending: number;
  approved: { id: string; startAt: string; endAt: string; purpose: string | null; event: { code: string; titleTh: string } | null }[];
}

export const VENUE_TYPE_LABEL: Record<VenueType, string> = {
  MEETING_ROOM: 'ห้องประชุม',
  LAB: 'ห้องปฏิบัติการ',
  AUDITORIUM: 'หอประชุม',
  CLASSROOM: 'ห้องเรียน',
  OUTDOOR: 'พื้นที่กลางแจ้ง',
  OTHER: 'อื่น ๆ',
};

export const BOOKING_STATUS: Record<BookingStatus, { label: string; color: string }> = {
  PENDING: { label: 'รอพิจารณา', color: 'gold' },
  APPROVED: { label: 'อนุมัติ', color: 'green' },
  REJECTED: { label: 'ไม่อนุมัติ', color: 'red' },
  CANCELLED: { label: 'ยกเลิก', color: 'default' },
};
