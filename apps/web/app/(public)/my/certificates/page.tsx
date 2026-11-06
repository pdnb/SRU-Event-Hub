'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Skeleton } from 'antd';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ErrorState } from '@/components/QueryState';
import { openPdf } from '@/features/badges/print';
import { MyCertificateList } from '@/features/certificates/MyCertificateList';
import type { MyCertificates } from '@/features/certificates/types';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useMe } from '@/hooks/useMe';
import { api } from '@/services/api';

export default function MyCertificatesPage() {
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const list = useQuery({ queryKey: ['my-certificates'], queryFn: () => api.get<MyCertificates>('/me/certificates'), enabled: !!me.data });
  const claim = useMutation({
    mutationFn: (c: MyCertificates['claimable'][number]) => api.post<{ id: string }>('/me/certificates/claim', { templateId: c.templateId, registrationId: c.registrationId }),
    onSuccess: (r) => {
      msg.success('ได้รับเกียรติบัตรแล้ว');
      void qc.invalidateQueries({ queryKey: ['my-certificates'] });
      void openPdf(api.http.get(`/certificates/${r.id}/pdf`, { responseType: 'blob' })).catch(msg.error);
    },
    onError: msg.error,
  });

  useEffect(() => {
    if (me.isError) router.replace('/login?next=/my/certificates');
  }, [me.isError, router]);

  return (
    <div className="page-container" style={{ paddingTop: 24, maxWidth: 900 }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>เกียรติบัตรของฉัน</h1>
      <p style={{ color: '#6b7280', marginTop: 0 }}>ดาวน์โหลดเกียรติบัตรของกิจกรรมที่เข้าร่วม — ทุกฉบับมี QR ให้ผู้อื่นตรวจสอบความถูกต้องได้</p>
      <Card>
        {me.isPending || list.isPending ? (
          <Skeleton active />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : (
          <MyCertificateList
            data={list.data}
            claiming={claim.isPending && claim.variables ? claim.variables.templateId + claim.variables.registrationId : null}
            onClaim={(c) => claim.mutate(c)}
            onDownload={(id) => void openPdf(api.http.get(`/certificates/${id}/pdf`, { responseType: 'blob' })).catch(msg.error)}
          />
        )}
      </Card>
    </div>
  );
}
