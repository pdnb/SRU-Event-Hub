export interface ReportFilters {
  fiscalYear?: number;
  from?: string;
  to?: string;
  organizationId?: string;
  categoryId?: string;
}

export interface Overview {
  period: { from: string; to: string; label: string };
  kpis: {
    events: number;
    held: number;
    upcoming: number;
    cancelled: number;
    confirmed: number;
    uniqueParticipants: number;
    attended: number;
    attendanceRate: number | null;
    collected: number;
    refunded: number;
    net: number;
    certificates: number;
    responses: number;
    satisfaction: number | null;
  };
  trend: { month: string; events: number; confirmed: number; attended: number; net: number }[];
  byOrganization: { id: string; name: string; events: number; confirmed: number; attended: number; net: number }[];
  byCategory: { name: string; events: number; confirmed: number }[];
  byParticipantType: { name: string; confirmed: number; attended: number; attendanceRate: number | null }[];
}

export interface EventReportRow {
  id: string;
  code: string;
  titleTh: string;
  organizationName: string;
  categoryName: string | null;
  status: string;
  startAt: string;
  endAt: string;
  capacity: number | null;
  confirmed: number;
  attended: number;
  attendanceRate: number | null;
  collected: number;
  refunded: number;
  certificates: number;
  responses: number;
  satisfaction: number | null;
}

export interface FinanceReport {
  period: { label: string };
  totals: { transfer: number; onsite: number; refunded: number; net: number };
  monthly: { month: string; transfer: number; onsite: number; refunded: number; net: number }[];
  outstanding: { slipsPending: number; slipsAmount: number; ordersUnpaid: number; unpaidAmount: number; refundsOpen: number };
}

export interface ParticipantReport {
  period: { label: string };
  totals: { registrations: number; uniquePeople: number; repeatPeople: number; viaGroups: number; guests: number };
  topAffiliations: { name: string; registrations: number; people: number }[];
  frequency: { events: number; people: number }[];
}

export interface DashboardTask {
  key: string;
  label: string;
  count: number;
  href: string;
  tone: 'action' | 'warn' | 'info';
}
