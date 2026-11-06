'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Divider, Modal, Skeleton, Tag, Typography } from 'antd';
import { useState } from 'react';
import { ErrorState } from '@/components/QueryState';
import { List } from '@/components/SimpleList';
import { EvaluationRespond } from '@/features/evaluations/EvaluationRespond';
import type { MyEvaluation, RespondView } from '@/features/evaluations/types';
import { useApiMessage } from '@/hooks/useApiMessage';
import { api } from '@/services/api';
import { MyCertificateList } from './MyCertificateList';
import type { MyCertificates } from './types';

/** Opens a PDF returned by a POST (guest download keeps the access token out of URLs). */
async function openPostedPdf(url: string, body: object) {
  const res = await api.http.post(url, body, { responseType: 'blob' });
  const href = URL.createObjectURL(new Blob([res.data as Blob], { type: 'application/pdf' }));
  window.open(href, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(href), 120_000);
}

/**
 * After the event, a guest (reference number + access token, no account) answers the evaluation
 * and claims / downloads certificates from the registration status page.
 */
export function GuestAfterEvent({ creds }: { creds: { referenceNo: string; token: string } }) {
  const msg = useApiMessage();
  const qc = useQueryClient();
  const body = { referenceNo: creds.referenceNo.trim().toUpperCase(), token: creds.token.trim() };
  const [formId, setFormId] = useState<string | null>(null);
  const evals = useQuery({ queryKey: ['guest-evaluations', body.referenceNo], queryFn: () => api.post<MyEvaluation[]>('/public/registrations/evaluations', body) });
  const certs = useQuery({ queryKey: ['guest-certificates', body.referenceNo], queryFn: () => api.post<MyCertificates>('/public/registrations/certificates', body) });
  const view = useQuery({ queryKey: ['guest-evaluation-view', formId], queryFn: () => api.post<RespondView>(`/public/evaluation-forms/${formId}/view`, body), enabled: !!formId, refetchOnWindowFocus: false });
  const download = (certificateId: string) => void openPostedPdf('/public/registrations/certificates/pdf', { ...body, certificateId }).catch(msg.error);
  const claim = useMutation({
    mutationFn: (c: MyCertificates['claimable'][number]) => api.post<{ id: string }>('/public/registrations/certificates/claim', { ...body, templateId: c.templateId }),
    onSuccess: (r) => {
      msg.success('ได้รับเกียรติบัตรแล้ว');
      void qc.invalidateQueries({ queryKey: ['guest-certificates', body.referenceNo] });
      download(r.id);
    },
    onError: msg.error,
  });

  return (
    <>
      {!!evals.data?.length && (
        <>
          <Divider titlePlacement="start">แบบประเมินกิจกรรม</Divider>
          <List
            dataSource={evals.data}
            renderItem={(f) => (
              <List.Item
                actions={[
                  f.answered ? (
                    <Tag key="a" color="green">
                      ตอบแล้ว
                    </Tag>
                  ) : f.canAnswer ? (
                    <Button key="g" type="primary" onClick={() => setFormId(f.formId)}>
                      ตอบแบบประเมิน
                    </Button>
                  ) : (
                    <Typography.Text key="r" type="secondary">
                      {f.reason}
                    </Typography.Text>
                  ),
                ]}
              >
                <List.Item.Meta title={f.titleTh} description={f.requiredForCertificate ? 'ต้องตอบก่อนรับเกียรติบัตร' : undefined} />
              </List.Item>
            )}
          />
        </>
      )}
      <Divider titlePlacement="start">เกียรติบัตร</Divider>
      {certs.isPending ? (
        <Skeleton active />
      ) : certs.isError ? (
        <ErrorState error={certs.error} onRetry={() => certs.refetch()} />
      ) : (
        <MyCertificateList data={certs.data} showEvent={false} onDownload={download} onClaim={(c) => claim.mutate(c)} claiming={claim.isPending && claim.variables ? claim.variables.templateId + claim.variables.registrationId : null} />
      )}
      <Modal open={!!formId} footer={null} width={760} onCancel={() => setFormId(null)} destroyOnHidden title="แบบประเมินกิจกรรม">
        {view.isPending ? (
          <Skeleton active />
        ) : view.isError ? (
          <ErrorState error={view.error} onRetry={() => view.refetch()} />
        ) : (
          <EvaluationRespond
            view={view.data}
            submit={(answers) => api.post(`/public/evaluation-forms/${formId}/responses`, { ...body, answers })}
            onDone={() => {
              void qc.invalidateQueries({ queryKey: ['guest-evaluations', body.referenceNo] });
              void qc.invalidateQueries({ queryKey: ['guest-certificates', body.referenceNo] });
            }}
          />
        )}
      </Modal>
    </>
  );
}
