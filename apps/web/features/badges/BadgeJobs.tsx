'use client';

import { PrinterOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, Table, Tag } from 'antd';
import { useState } from 'react';
import { ThaiDate } from '@/components/Format';
import { ErrorState } from '@/components/QueryState';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';
import { printPdf } from './print';
import { MODE_LABEL, type PrintJob } from './types';

/** Every print request; re-opening a job's PDF is counted and audited. */
export function BadgeJobs({ eventId }: { eventId: string }) {
  const can = useCan();
  const msg = useApiMessage();
  const [q, setQ] = useState({ page: 1, perPage: 20 });
  const list = useQuery({ queryKey: ['badge-jobs', eventId, q], queryFn: () => api.getPage<PrintJob>(`/events/${eventId}/badge-print-jobs`, q), placeholderData: keepPreviousData });
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  return (
    <Table<PrintJob>
      rowKey="id"
      size="small"
      loading={list.isFetching}
      dataSource={list.data?.items}
      scroll={{ x: 860 }}
      pagination={{ current: q.page, pageSize: q.perPage, total: list.data?.meta.total, onChange: (page, perPage) => setQ({ page, perPage }) }}
      columns={[
        { title: 'เวลา', dataIndex: 'createdAt', width: 170, render: (d) => <ThaiDate value={d} time /> },
        { title: 'ประเภท', dataIndex: 'mode', width: 110, render: (m) => <Tag color={MODE_LABEL[m]?.color}>{MODE_LABEL[m]?.text}</Tag> },
        { title: 'จำนวนป้าย', dataIndex: 'itemCount', width: 100, align: 'right' },
        { title: 'แม่แบบ', render: (_, j) => j.template.nameTh },
        { title: 'ผู้สั่งพิมพ์', render: (_, j) => j.requestedBy.displayName },
        { title: 'เหตุผล', dataIndex: 'reason', render: (r) => r ?? '-' },
        { title: 'เปิดไฟล์', dataIndex: 'downloadCount', width: 90, align: 'right', render: (n) => `${n} ครั้ง` },
        {
          title: '',
          width: 110,
          render: (_, j) =>
            can('badge:print') && (
              <Button size="small" icon={<PrinterOutlined />} onClick={() => printPdf(`/badge-print-jobs/${j.id}/pdf`).then(() => list.refetch()).catch(msg.error)}>
                เปิดอีกครั้ง
              </Button>
            ),
        },
      ]}
    />
  );
}
