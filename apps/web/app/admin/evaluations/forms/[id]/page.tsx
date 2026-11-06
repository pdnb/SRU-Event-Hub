'use client';

import { useQuery } from '@tanstack/react-query';
import { Tabs } from 'antd';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { QueryState } from '@/components/QueryState';
import { EvaluationBuilder } from '@/features/evaluations/EvaluationBuilder';
import { EvaluationSummary } from '@/features/evaluations/EvaluationSummary';
import type { EvaluationForm } from '@/features/evaluations/types';
import { api } from '@/services/api';

export default function EvaluationFormPage() {
  const { id } = useParams<{ id: string }>();
  const form = useQuery({ queryKey: ['evaluation-form', id], queryFn: () => api.get<EvaluationForm>(`/evaluation-forms/${id}`), staleTime: Infinity, refetchOnWindowFocus: false });
  const event = useQuery({
    queryKey: ['admin-event', form.data?.eventId],
    queryFn: () => api.get<{ code: string; titleTh: string }>(`/events/${form.data!.eventId}`),
    enabled: !!form.data,
  });

  return (
    <QueryState query={form}>
      {(f) => (
        <>
          <PageHeader
            title={f.titleTh}
            description={event.data?.titleTh}
            breadcrumb={[{ title: 'แบบประเมิน', href: '/admin/evaluations' }, { title: event.data?.code ?? '…', href: `/admin/evaluations/${f.eventId}` }, { title: f.titleTh }]}
          />
          <Tabs
            defaultActiveKey={f.responseCount ? 'results' : 'edit'}
            items={[
              { key: 'results', label: `ผลการประเมิน (${f.responseCount})`, children: <EvaluationSummary formId={f.id} /> },
              { key: 'edit', label: 'แบบฟอร์ม', children: <EvaluationBuilder key={f.id} form={f} /> },
            ]}
          />
        </>
      )}
    </QueryState>
  );
}
