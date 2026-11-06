'use client';

import { FileDoneOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Flex, Tabs, Typography } from 'antd';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ThaiDateRange } from '@/components/Format';
import { PageHeader } from '@/components/PageHeader';
import { QueryState } from '@/components/QueryState';
import { CertificateIssuePanel } from '@/features/certificates/CertificateIssuePanel';
import { CertificateRegister } from '@/features/certificates/CertificateRegister';
import { CertificateTemplates } from '@/features/certificates/CertificateTemplates';
import type { CertTemplate } from '@/features/certificates/types';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';

export default function EventCertificatesPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const can = useCan();
  const [now] = useState(() => Date.now());
  const event = useQuery({ queryKey: ['admin-event', eventId], queryFn: () => api.get<{ id: string; code: string; titleTh: string; startAt: string; endAt: string }>(`/events/${eventId}`) });
  const templates = useQuery({ queryKey: ['certificate-templates', eventId], queryFn: () => api.get<CertTemplate[]>(`/events/${eventId}/certificate-templates`) });

  return (
    <QueryState query={event}>
      {(e) => (
        <>
          <PageHeader
            title={`เกียรติบัตร: ${e.titleTh}`}
            description={
              <Flex gap={8} wrap>
                <Typography.Text code>{e.code}</Typography.Text>
                <ThaiDateRange start={e.startAt} end={e.endAt} />
              </Flex>
            }
            breadcrumb={[{ title: 'เกียรติบัตร', href: '/admin/certificates' }, { title: e.code }]}
            actions={
              can('evaluation:view') && (
                <Link href={`/admin/evaluations/${eventId}`}>
                  <Button icon={<FileDoneOutlined />}>แบบประเมิน</Button>
                </Link>
              )
            }
          />
          <QueryState query={templates}>
            {(t) => (
              <Tabs
                items={[
                  { key: 'issue', label: 'ออกเกียรติบัตร', children: <Card><CertificateIssuePanel eventId={eventId} templates={t} eventStarted={new Date(e.startAt).getTime() <= now} /></Card> },
                  { key: 'register', label: 'ทะเบียนเกียรติบัตร', children: <Card><CertificateRegister eventId={eventId} /></Card> },
                  { key: 'templates', label: `แม่แบบ (${t.length})`, children: <CertificateTemplates eventId={eventId} templates={t} /> },
                ]}
              />
            )}
          </QueryState>
        </>
      )}
    </QueryState>
  );
}
