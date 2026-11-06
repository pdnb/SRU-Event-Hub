import { Tag } from 'antd';
import { STATUS_META, STATUS_META_BY_KIND } from '@sru/shared-types';

export type StatusKind = 'payment' | 'refund' | 'cashier' | 'batch' | 'registration' | 'group' | 'import';

/** One status → one colour + Thai label everywhere (spec §7); `kind` disambiguates shared codes. */
export function StatusTag({ status, kind }: { status: string; kind?: StatusKind }) {
  const meta = (kind && STATUS_META_BY_KIND[kind]?.[status]) || STATUS_META[status] || { label: status, color: 'default' };
  return <Tag color={meta.color}>{meta.label}</Tag>;
}
