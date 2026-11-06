'use client';

import { SafetyCertificateOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Flex, Typography } from 'antd';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ThaiDateRange } from '@/components/Format';
import { PageHeader } from '@/components/PageHeader';
import { QueryState } from '@/components/QueryState';
import { EvaluationForms } from '@/features/evaluations/EvaluationForms';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';

export default function EventEvaluationsPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const can = useCan();
  const event = useQuery({ queryKey: ['admin-event', eventId], queryFn: () => api.get<{ id: string; code: string; titleTh: string; startAt: string; endAt: string }>(`/events/${eventId}`) });

  return (
    <QueryState query={event}>
      {(e) => (
        <>
          <PageHeader
            title={`แบบประเมิน: ${e.titleTh}`}
            description={
              <Flex gap={8} wrap>
                <Typography.Text code>{e.code}</Typography.Text>
                <ThaiDateRange start={e.startAt} end={e.endAt} />
              </Flex>
            }
            breadcrumb={[{ title: 'แบบประเมิน', href: '/admin/evaluations' }, { title: e.code }]}
            actions={
              can('certificate:view') && (
                <Link href={`/admin/certificates/${eventId}`}>
                  <Button icon={<SafetyCertificateOutlined />}>เกียรติบัตร</Button>
                </Link>
              )
            }
          />
          <EvaluationForms eventId={eventId} />
        </>
      )}
    </QueryState>
  );
}
