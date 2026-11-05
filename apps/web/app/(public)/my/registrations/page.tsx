'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Empty, List, Modal, Popconfirm, Skeleton, Typography } from 'antd';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { RegistrationDto } from '@sru/shared-types';
import { ThaiDateRange } from '@/components/Format';
import { ErrorState } from '@/components/QueryState';
import { StatusTag } from '@/components/StatusTag';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useMe } from '@/hooks/useMe';
import { PaymentPanel } from '@/features/payment/PaymentPanel';
import { api } from '@/services/api';

type Mine = RegistrationDto & { event: { id: string; code: string; titleTh: string; startAt: string; endAt: string; venueText: string | null; status: string; allowSelfCancel: boolean } };

export default function MyRegistrationsPage() {
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const [payingId, setPayingId] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['my-registrations'], queryFn: () => api.get<Mine[]>('/me/registrations'), enabled: !!me.data });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/registrations/${id}/cancel`, {}),
    onSuccess: () => {
      msg.success('ยกเลิกการลงทะเบียนแล้ว');
      void qc.invalidateQueries({ queryKey: ['my-registrations'] });
    },
    onError: msg.error,
  });

  const paying = list.data?.find((r) => r.id === payingId);

  useEffect(() => {
    if (me.isError) router.replace('/login?next=/my/registrations');
  }, [me.isError, router]);

  return (
    <div className="page-container" style={{ paddingTop: 24, maxWidth: 900 }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>ประวัติการลงทะเบียนของฉัน</h1>
      <p style={{ color: '#6b7280', marginTop: 0 }}>กิจกรรมที่ท่านลงทะเบียนขณะเข้าสู่ระบบ</p>
      <Card>
        {me.isPending || list.isPending ? (
          <Skeleton active />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : !list.data.length ? (
          <Empty description="ยังไม่มีประวัติการลงทะเบียน">
            <Link href="/events?tab=open">
              <Button type="primary">ดูกิจกรรมที่เปิดรับสมัคร</Button>
            </Link>
          </Empty>
        ) : (
          <List
            dataSource={list.data}
            renderItem={(r) => (
              <List.Item
                actions={[
                  <StatusTag key="s" status={r.status} />,
                  r.payment && ['UNPAID', 'PENDING_VERIFICATION', 'PAID'].includes(r.payment.status) ? (
                    <Button key="p" size="small" type={r.payment.status === 'UNPAID' ? 'primary' : 'default'} onClick={() => setPayingId(r.id)}>
                      {r.payment.status === 'UNPAID' ? 'ชำระเงิน' : 'การชำระเงิน'}
                    </Button>
                  ) : null,
                  r.event.allowSelfCancel && ['CONFIRMED', 'WAITLISTED', 'PENDING_PAYMENT'].includes(r.status) && new Date(r.event.startAt) > new Date() ? (
                    <Popconfirm key="c" title="ยกเลิกการลงทะเบียน?" okText="ยืนยัน" cancelText="ไม่" okButtonProps={{ danger: true }} onConfirm={() => cancel.mutate(r.id)}>
                      <Button size="small" danger type="link">ยกเลิก</Button>
                    </Popconfirm>
                  ) : null,
                ].filter(Boolean)}
              >
                <List.Item.Meta
                  title={<Link href={`/events/${r.event.code}`}>{r.event.titleTh}</Link>}
                  description={
                    <Typography.Text type="secondary">
                      <ThaiDateRange start={r.event.startAt} end={r.event.endAt} /> · {r.referenceNo}
                    </Typography.Text>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>
      <Modal open={!!paying?.payment} onCancel={() => setPayingId(null)} footer={null} width={760} title={paying?.event.titleTh} destroyOnHidden>
        {paying?.payment && (
          <PaymentPanel
            order={paying.payment}
            upload={(file, transferredAt) => api.payments.uploadSlip(paying.id, file, { transferredAt })}
            onChanged={() => void qc.invalidateQueries({ queryKey: ['my-registrations'] })}
          />
        )}
      </Modal>
    </div>
  );
}
