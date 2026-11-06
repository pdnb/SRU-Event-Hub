export interface CertField {
  kind: 'TEXT' | 'QR';
  content: string | null;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  fontSize: number;
  bold: boolean;
  align: 'left' | 'center' | 'right';
  color: string | null;
}

export type PersonnelRole = 'SPEAKER' | 'STAFF' | 'VIP' | 'ORGANIZER' | 'VOLUNTEER' | 'MEDIA' | 'OTHER';

export interface CertTemplate {
  id: string;
  eventId: string;
  nameTh: string;
  audience: 'PARTICIPANT' | 'PERSONNEL';
  personnelRoles: PersonnelRole[];
  widthMm: number;
  heightMm: number;
  backgroundColor: string | null;
  backgroundFileId: string | null;
  fields: CertField[];
  requireAttendance: boolean;
  countLate: boolean;
  minSessionPercent: number | null;
  requireEvaluation: boolean;
  allowSelfClaim: boolean;
  version: number;
  issuedCount?: number;
}

export interface Candidate {
  kind: 'registration' | 'personnel';
  id: string;
  referenceNo: string | null;
  fullName: string;
  detail: string;
  affiliation: string | null;
  attendance: string | null;
  sessions: string | null;
  eligibility: { eligible: boolean; reasons: string[] };
  certificate: { id: string; certificateNo: string; issuedAt: string } | null;
}

export interface CertificateRow {
  id: string;
  certificateNo: string;
  verifyCode: string;
  verifyUrl: string;
  recipientName: string;
  status: 'ISSUED' | 'REVOKED';
  issueMethod: 'ADMIN' | 'SELF_CLAIM';
  issuedAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  downloadCount: number;
  template: { id: string; nameTh: string };
  registration: { referenceNo: string } | null;
  issuedBy: { displayName: string } | null;
}

export interface MyCertificates {
  issued: {
    id: string;
    certificateNo: string;
    verifyCode: string;
    verifyUrl: string;
    recipientName: string;
    issuedAt: string;
    template: { nameTh: string };
    event: { id: string; code: string; titleTh: string; startAt: string };
  }[];
  claimable: {
    templateId: string;
    nameTh: string;
    registrationId: string;
    event: { id: string; code: string; titleTh: string; startAt: string };
    eligible: boolean;
    reasons: string[];
  }[];
}

export interface VerifyResult {
  result: 'VALID' | 'REVOKED' | 'NOT_FOUND';
  certificateNo?: string;
  recipientName?: string;
  title?: string;
  issuedAt?: string;
  revokedAt?: string | null;
  event?: { code: string; titleTh: string; startAt: string; endAt: string; organizationName: string };
}

export const ROLE_LABEL: Record<PersonnelRole, string> = {
  SPEAKER: 'วิทยากร',
  STAFF: 'เจ้าหน้าที่',
  VIP: 'แขกผู้มีเกียรติ',
  ORGANIZER: 'คณะผู้จัด',
  VOLUNTEER: 'อาสาสมัคร',
  MEDIA: 'สื่อมวลชน',
  OTHER: 'อื่น ๆ',
};

export const ATTENDANCE_LABEL: Record<string, string> = { PRESENT: 'เข้าร่วม', LATE: 'มาสาย', ABSENT: 'ไม่เข้าร่วม', EXCUSED: 'ลา' };
