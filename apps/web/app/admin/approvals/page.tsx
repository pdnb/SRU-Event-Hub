'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, Table, Tag, Typography } from 'antd';
import Link from 'next/link';
import { ThaiDate } from '@/components/Format';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/QueryState';
import { api } from '@/services/api';

type Pending = {
  requestId: string;
  round: number;
  trigger: string;
  submittedAt: string;
  submittedBy: { displayName: string };
  step: { order: number; nameTh: string; isFinanceReview: boolean };
  event: { id: string; code: string; titleTh: string; organizationName: string; startAt: string; isPaid: boolean };
};

export default function ApprovalsPage() {
  const q = useQuery({ queryKey: ['approvals-pending'], queryFn: () => api.get<Pending[]>('/approvals/pending') });
  return (
    <>
      <PageHeader title="รายการรออนุมัติ" description="กิจกรรมที่อยู่ในขั้นตอนซึ่งท่านมีสิทธิ์พิจารณา" breadcrumb={[{ title: 'รายการรออนุมัติ' }]} />
      <Card>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <Table<Pending>
            rowKey="requestId"
            loading={q.isPending}
            dataSource={q.data}
            scroll={{ x: 800 }}
            locale={{ emptyText: 'ไม่มีรายการรอพิจารณา' }}
            pagination={{ pageSize: 20 }}
            columns={[
              { title: 'กิจกรรม', render: (_, r) => <Link href={`/admin/events/${r.event.id}`}>{r.event.titleTh}</Link> },
              { title: 'รหัส', width: 150, render: (_, r) => <Typography.Text code>{r.event.code}</Typography.Text> },
              { title: 'หน่วยงาน', width: 200, render: (_, r) => r.event.organizationName },
              {
                title: 'ขั้นตอน',
                width: 260,
                render: (_, r) => (
                  <>
                    {r.step.nameTh} {r.step.isFinanceReview && <Tag color="gold">การเงิน</Tag>}
                    {r.round > 1 && <Tag>รอบ {r.round}</Tag>}
                  </>
                ),
              },
              { title: 'เสนอโดย', width: 180, render: (_, r) => r.submittedBy.displayName },
              { title: 'วันที่เสนอ', width: 170, render: (_, r) => <ThaiDate value={r.submittedAt} time /> },
            ]}
          />
        )}
      </Card>
    </>
  );
}
