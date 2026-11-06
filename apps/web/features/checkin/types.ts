export type AttendanceStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED';

export interface DeskEvent {
  id: string;
  code: string;
  titleTh: string;
  status: string;
  startAt: string;
  endAt: string;
  venueText: string | null;
  organizationName: string;
  confirmed: number;
  checkedIn: number;
  isOpen: boolean;
}

export interface Registrant {
  id: string;
  referenceNo: string;
  fullName: string;
  status: string;
  participantType: string;
  participantTypeCode: string;
  affiliation: string | null;
  groupId: string | null;
  groupNo: string | null;
  groupName: string | null;
  badgePrints: number;
  attendance?: { status: AttendanceStatus; firstCheckinAt: string | null } | null;
}

export type Outcome = 'CHECKED_IN' | 'ALREADY_CHECKED_IN' | 'CHECKED_OUT' | 'NOT_CHECKED_IN';

export interface CheckinResult {
  kind?: 'REGISTRATION';
  outcome: Outcome;
  replayed: boolean;
  record: { id: string; occurredAt: string } | null;
  firstCheckinAt: string | null;
  attendance: { status: AttendanceStatus; firstCheckinAt: string | null; lastCheckoutAt: string | null } | null;
  registration: Registrant;
  scheduleId: string | null;
  locationId: string | null;
}

export interface GroupRoster {
  id: string;
  groupNo: string;
  name: string;
  status: string;
  organizationName: string;
  members: Registrant[];
}

export type ScanResponse = CheckinResult | { kind: 'GROUP'; group: GroupRoster };

export interface Schedule {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  venueText: string | null;
}

export interface Location {
  id: string;
  nameTh: string;
  scheduleId: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface CheckinSettings {
  event: { id: string; code: string; titleTh: string; status: string; startAt: string; endAt: string; venueText: string | null };
  opensBeforeMinutes: number;
  lateAfterMinutes: number | null;
  opensAt: string;
  closesAt: string;
  isOpen: boolean;
  locations: Location[];
  schedules: Schedule[];
}

export interface CheckinRecordDto {
  id: string;
  action: 'CHECK_IN' | 'CHECK_OUT' | 'UNDO';
  method: 'QR' | 'MANUAL' | 'GROUP' | 'OFFLINE';
  occurredAt: string;
  createdAt: string;
  note: string | null;
  registrationId: string;
  referenceNo: string;
  fullName: string;
  location: string | null;
  schedule: string | null;
  actor: string | null;
  undoesId: string | null;
  undone: { at: string; reason: string | null } | null;
}

export interface CheckinStats {
  event: { id: string; code: string; titleTh: string; startAt: string; endAt: string; isOpen: boolean };
  confirmed: number;
  pendingPayment: number;
  checkedIn: number;
  late: number;
  excused: number;
  notArrived: number;
  byLocation: { id: string | null; name: string; isActive: boolean; count: number }[];
  byParticipantType: { code: string; name: string; registered: number; present: number }[];
  bySchedule: { id: string; title: string; startAt: string; count: number }[];
  hourly: { hour: string; count: number }[];
  recent: CheckinRecordDto[];
}

export const ACTION_LABEL: Record<string, { text: string; color: string }> = {
  CHECK_IN: { text: 'เช็กอิน', color: 'green' },
  CHECK_OUT: { text: 'เช็กเอาต์', color: 'blue' },
  UNDO: { text: 'ยกเลิกรายการ', color: 'default' },
};
export const METHOD_LABEL: Record<string, string> = { QR: 'สแกน QR', MANUAL: 'ค้นหาชื่อ', GROUP: 'ทั้งกลุ่ม', OFFLINE: 'ออฟไลน์' };
export const ATTENDANCE_META: Record<AttendanceStatus, { label: string; color: string }> = {
  PRESENT: { label: 'เข้าร่วม', color: 'green' },
  LATE: { label: 'มาสาย', color: 'orange' },
  ABSENT: { label: 'ยังไม่มา / ไม่เข้าร่วม', color: 'default' },
  EXCUSED: { label: 'ลา', color: 'blue' },
};
