'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { QueryState } from '@/components/QueryState';
import { BadgeDesigner } from '@/features/badges/BadgeDesigner';
import type { BadgeTemplate } from '@/features/badges/types';
import { api } from '@/services/api';

export default function BadgeTemplatePage() {
  const { id } = useParams<{ id: string }>();
  const template = useQuery({ queryKey: ['badge-template', id], queryFn: () => api.get<BadgeTemplate>(`/badge-templates/${id}`), staleTime: Infinity, refetchOnWindowFocus: false });
  const event = useQuery({
    queryKey: ['admin-event', template.data?.eventId],
    queryFn: () => api.get<{ code: string; titleTh: string }>(`/events/${template.data!.eventId}`),
    enabled: !!template.data,
  });

  return (
    <QueryState query={template}>
      {(t) => (
        <>
          <PageHeader
            title={`ออกแบบป้ายชื่อ: ${t.nameTh}`}
            description={event.data?.titleTh}
            breadcrumb={[{ title: 'ป้ายชื่อ', href: '/admin/badges' }, { title: event.data?.code ?? '…', href: `/admin/badges/${t.eventId}` }, { title: t.nameTh }]}
          />
          {/* key: a different template (or a reload after save conflict) starts a fresh draft */}
          <BadgeDesigner key={`${t.id}`} template={t} eventTitle={event.data?.titleTh ?? 'ชื่อกิจกรรม'} />
        </>
      )}
    </QueryState>
  );
}
