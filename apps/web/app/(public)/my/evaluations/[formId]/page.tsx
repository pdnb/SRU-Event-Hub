'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Skeleton } from 'antd';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { ErrorState } from '@/components/QueryState';
import { EvaluationRespond } from '@/features/evaluations/EvaluationRespond';
import type { RespondView } from '@/features/evaluations/types';
import { useMe } from '@/hooks/useMe';
import { api } from '@/services/api';

export default function RespondPage() {
  // useSearchParams needs a Suspense boundary for static rendering.
  return (
    <Suspense>
      <Respond />
    </Suspense>
  );
}

function Respond() {
  const { formId } = useParams<{ formId: string }>();
  const registrationId = useSearchParams().get('registrationId') ?? '';
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const view = useQuery({
    queryKey: ['evaluation-respond', formId, registrationId],
    queryFn: () => api.get<RespondView>(`/evaluation-forms/${formId}/respond`, { registrationId }),
    enabled: !!me.data && !!registrationId,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (me.isError) router.replace(`/login?next=${encodeURIComponent(`/my/evaluations/${formId}?registrationId=${registrationId}`)}`);
  }, [me.isError, router, formId, registrationId]);

  return (
    <div className="page-container" style={{ paddingTop: 24, maxWidth: 760 }}>
      {me.isPending || view.isPending ? (
        <Card>
          <Skeleton active />
        </Card>
      ) : view.isError ? (
        <ErrorState error={view.error} onRetry={() => view.refetch()} />
      ) : (
        <EvaluationRespond
          view={view.data}
          submit={(answers) => api.post(`/evaluation-forms/${formId}/responses`, { registrationId, answers })}
          onDone={() => {
            void qc.invalidateQueries({ queryKey: ['my-evaluations'] });
            void qc.invalidateQueries({ queryKey: ['my-certificates'] });
          }}
        />
      )}
      <div style={{ marginTop: 16 }}>
        <Link href="/my/evaluations">
          <Button type="link">← แบบประเมินทั้งหมด</Button>
        </Link>
        <Link href="/my/certificates">
          <Button type="link">เกียรติบัตรของฉัน</Button>
        </Link>
      </div>
    </div>
  );
}
