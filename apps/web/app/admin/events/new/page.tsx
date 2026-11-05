'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { EventForm } from '@/features/events/EventForm';
import { toPayload } from '@/features/events/event-form-schema';
import { useApiMessage } from '@/hooks/useApiMessage';
import { api } from '@/services/api';

export default function NewEventPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const create = useMutation({
    mutationFn: (body: ReturnType<typeof toPayload>) => api.post<{ id: string; code: string }>('/events', body),
    onSuccess: (r) => {
      msg.success(`บันทึกฉบับร่างแล้ว (${r.code})`);
      void qc.invalidateQueries({ queryKey: ['admin-events'] });
      router.push(`/admin/events/${r.id}`);
    },
    onError: msg.error,
  });

  return (
    <>
      <PageHeader
        title="สร้างกิจกรรม"
        description="บันทึกเป็นฉบับร่างก่อน แล้วจึงเสนออนุมัติจากหน้ารายละเอียดกิจกรรม"
        breadcrumb={[{ title: 'จัดการกิจกรรม', href: '/admin/events' }, { title: 'สร้างกิจกรรม' }]}
      />
      <EventForm onSubmit={(v) => create.mutate(toPayload(v))} submitting={create.isPending} />
    </>
  );
}
