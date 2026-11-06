export type QuestionKind = 'SECTION' | 'RATING' | 'SINGLE' | 'MULTI' | 'TEXT' | 'TEXTAREA';

export interface Question {
  id?: string;
  kind: QuestionKind;
  labelTh: string;
  helpText: string | null;
  isRequired: boolean;
  scaleMax: number;
  options: { id?: string; labelTh: string }[];
}

export interface EvaluationForm {
  id: string;
  eventId: string;
  titleTh: string;
  description: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  isAnonymous: boolean;
  requireAttendance: boolean;
  requiredForCertificate: boolean;
  opensAt: string | null;
  closesAt: string | null;
  publishedAt: string | null;
  version: number;
  responseCount: number;
  questions: Question[];
}

export interface FormSummaryRow {
  id: string;
  titleTh: string;
  status: EvaluationForm['status'];
  isAnonymous: boolean;
  requiredForCertificate: boolean;
  questionCount: number;
  responseCount: number;
  createdAt: string;
}

export interface Summary {
  form: { id: string; titleTh: string; status: string; isAnonymous: boolean };
  responses: number;
  expected: number;
  responseRate: number | null;
  overallMean: number | null;
  overallLevel: string | null;
  questions: (
    | { id: string; kind: 'SECTION'; labelTh: string }
    | { id: string; kind: 'RATING'; labelTh: string; n: number; scaleMax: number; mean: number | null; sd: number | null; level: string | null; distribution: { value: number; count: number }[] }
    | { id: string; kind: 'SINGLE' | 'MULTI'; labelTh: string; n: number; options: { id: string; labelTh: string; count: number }[] }
    | { id: string; kind: 'TEXT' | 'TEXTAREA'; labelTh: string; n: number; texts: string[] }
  )[];
}

export interface RespondView {
  id: string;
  titleTh: string;
  description: string | null;
  status: EvaluationForm['status'];
  isAnonymous: boolean;
  questions: (Question & { id: string; options: { id: string; labelTh: string }[] })[];
  event: { code: string; titleTh: string; startAt: string; endAt: string };
  answered: boolean;
  canAnswer: boolean;
  reason: string | null;
}

export interface MyEvaluation {
  formId: string;
  titleTh: string;
  status: EvaluationForm['status'];
  requiredForCertificate: boolean;
  closesAt: string | null;
  registrationId: string;
  referenceNo: string;
  event: { id: string; code: string; titleTh: string; startAt: string; endAt: string };
  answered: boolean;
  canAnswer: boolean;
  reason: string | null;
}

export const KIND_LABEL: Record<QuestionKind, string> = {
  SECTION: 'หัวข้อ / คำชี้แจง',
  RATING: 'ระดับคะแนน',
  SINGLE: 'เลือกได้ 1 ข้อ',
  MULTI: 'เลือกได้หลายข้อ',
  TEXT: 'ข้อความสั้น',
  TEXTAREA: 'ข้อความยาว',
};

export const FORM_STATUS: Record<EvaluationForm['status'], { label: string; color: string }> = {
  DRAFT: { label: 'ฉบับร่าง', color: 'default' },
  PUBLISHED: { label: 'เปิดรับคำตอบ', color: 'green' },
  CLOSED: { label: 'ปิดรับแล้ว', color: 'red' },
};
