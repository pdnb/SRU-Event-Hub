import { STATUS_META, STATUS_META_BY_KIND } from '@sru/shared-types';

export const UNIVERSITY_NAME = 'มหาวิทยาลัยราชภัฏสุราษฎร์ธานี';

/** Same Thai label the screens show (StatusTag), so paper and screen agree. */
export function statusLabel(status: string, kind?: 'payment' | 'refund' | 'cashier' | 'batch'): string {
  return (kind && STATUS_META_BY_KIND[kind]?.[status]?.label) || STATUS_META[status]?.label || status;
}
