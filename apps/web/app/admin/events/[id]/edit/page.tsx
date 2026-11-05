'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { QueryState } from '@/components/QueryState';
import { EDITABLE, toFormValues, type AdminEventDto } from '@/features/events/admin-event';
import { EventForm } from '@/features/events/EventForm';
import { toPayload, type EventFormValues } from '@/features/events/event-form-schema';
import { useApiMessage } from '@/hooks/useApiMessage';
import { api } from '@/services/api';

/** Fields the API accepts after approval (mirrors POST_APPROVAL_FIELDS on the server). */
const POST_APPROVAL_KEYS = ['description', 'objectives', 'targetAudience', 'conditions', 'isFeatured', 'capacity', 'allowWaitlist', 'tags'] as const;

export default function EditEventPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const ev = useQuery({ queryKey: ['admin-event', id], queryFn: () => api.get<AdminEventDto>(`/events/${id}`) });

  const save = useMutation({
    mutationFn: ({ v, e }: { v: EventFormValues; e: AdminEventDto }) => {
      const full = toPayload(v);
      const { organizationId: _o, ...rest } = full;
      const body = EDITABLE.includes(e.status)
        ? rest
        : Object.fromEntries(POST_APPROVAL_KEYS.map((k) => [k, full[k]]));
      return api.patch(`/events/${id}`, { ...body, version: e.version });
    },
    onSuccess: () => {
      msg.success('บันทึกการแก้ไขแล้ว');
      void qc.invalidateQueries({ queryKey: ['admin-event', id] });
      router.push(`/admin/events/${id}`);
    },
    onError: msg.error,
  });

  return (
    <QueryState query={ev}>
      {(e) => (
        <>
          <PageHeader
            title="แก้ไขกิจกรรม"
            description={`${e.code} · ${e.titleTh}`}
            breadcrumb={[{ title: 'จัดการกิจกรรม', href: '/admin/events' }, { title: e.code, href: `/admin/events/${id}` }, { title: 'แก้ไข' }]}
          />
          <EventForm
            defaultValues={toFormValues(e)}
            lockedAfterApproval={!EDITABLE.includes(e.status)}
            onSubmit={(v) => save.mutate({ v, e })}
            submitting={save.isPending}
          />
        </>
      )}
    </QueryState>
  );
}
