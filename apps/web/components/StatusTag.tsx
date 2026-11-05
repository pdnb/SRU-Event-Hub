import { Tag } from 'antd';
import { STATUS_META } from '@sru/shared-types';

/** One status → one colour + Thai label everywhere (spec §7). */
export function StatusTag({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, color: 'default' };
  return <Tag color={meta.color}>{meta.label}</Tag>;
}
