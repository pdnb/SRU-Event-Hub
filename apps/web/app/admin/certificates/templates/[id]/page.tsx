'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { QueryState } from '@/components/QueryState';
import { CertificateDesigner } from '@/features/certificates/CertificateDesigner';
import type { CertTemplate } from '@/features/certificates/types';
import { api } from '@/services/api';

export default function CertificateTemplatePage() {
  const { id } = useParams<{ id: string }>();
  const template = useQuery({ queryKey: ['certificate-template', id], queryFn: () => api.get<CertTemplate>(`/certificate-templates/${id}`), staleTime: Infinity, refetchOnWindowFocus: false });
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
            title={`ออกแบบเกียรติบัตร: ${t.nameTh}`}
            description={event.data?.titleTh}
            breadcrumb={[{ title: 'เกียรติบัตร', href: '/admin/certificates' }, { title: event.data?.code ?? '…', href: `/admin/certificates/${t.eventId}` }, { title: t.nameTh }]}
          />
          <CertificateDesigner key={t.id} template={t} eventTitle={event.data?.titleTh ?? 'ชื่อกิจกรรม'} />
        </>
      )}
    </QueryState>
  );
}
