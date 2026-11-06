'use client';

import { QrcodeOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Flex, Tabs, Typography } from 'antd';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ThaiDateRange } from '@/components/Format';
import { PageHeader } from '@/components/PageHeader';
import { QueryState } from '@/components/QueryState';
import { BadgeJobs } from '@/features/badges/BadgeJobs';
import { BadgePrintPanel } from '@/features/badges/BadgePrintPanel';
import { BadgeTemplates } from '@/features/badges/BadgeTemplates';
import { PersonnelPanel } from '@/features/badges/PersonnelPanel';
import type { TemplateSummary } from '@/features/badges/types';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';

export default function EventBadgesPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const can = useCan();
  const event = useQuery({ queryKey: ['admin-event', eventId], queryFn: () => api.get<{ id: string; code: string; titleTh: string; startAt: string; endAt: string }>(`/events/${eventId}`) });
  const templates = useQuery({ queryKey: ['badge-templates', eventId], queryFn: () => api.get<TemplateSummary[]>(`/events/${eventId}/badge-templates`) });

  return (
    <QueryState query={event}>
      {(e) => (
        <>
          <PageHeader
            title={`ป้ายชื่อ: ${e.titleTh}`}
            description={
              <Flex gap={8} wrap>
                <Typography.Text code>{e.code}</Typography.Text>
                <ThaiDateRange start={e.startAt} end={e.endAt} />
              </Flex>
            }
            breadcrumb={[{ title: 'ป้ายชื่อ', href: '/admin/badges' }, { title: e.code }]}
            actions={
              can('checkin:view') && (
                <Link href={`/admin/checkin/${eventId}`}>
                  <Button icon={<QrcodeOutlined />}>จุดเช็กอิน</Button>
                </Link>
              )
            }
          />
          <QueryState query={templates}>
            {(t) => (
              <Tabs
                items={[
                  { key: 'print', label: 'พิมพ์ป้ายชื่อ', children: <Card><BadgePrintPanel eventId={eventId} templates={t} /></Card> },
                  { key: 'templates', label: `แม่แบบป้ายชื่อ (${t.length})`, children: <BadgeTemplates eventId={eventId} templates={t} /> },
                  { key: 'personnel', label: 'บุคลากรของงาน', children: <Card><PersonnelPanel eventId={eventId} /></Card> },
                  { key: 'jobs', label: 'ประวัติการพิมพ์', children: <Card><BadgeJobs eventId={eventId} /></Card> },
                ]}
              />
            )}
          </QueryState>
        </>
      )}
    </QueryState>
  );
}
