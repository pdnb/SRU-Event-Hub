'use client';

import { CheckOutlined, CloseOutlined, StopOutlined } from '@ant-design/icons';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, Modal, Segmented, Space, Table, Tag, Typography } from 'antd';
import Link from 'next/link';
import { useState } from 'react';
import { ThaiDate } from '@/components/Format';
import { ErrorState } from '@/components/QueryState';
import { useApiMessage } from '@/hooks/useApiMessage';
import { api } from '@/services/api';
import { BOOKING_STATUS, type Booking } from './types';

type View = 'approve' | 'mine' | 'event';

/** Venue + equipment bookings: approval inbox, my requests, or one event's bookings. */
export function BookingList({ view, eventId, canCancel = true }: { view: View; eventId?: string; canCancel?: boolean }) {
  const qc = useQueryClient();
  const msg = useApiMessage();
  const [kind, setKind] = useState<'venue' | 'resource'>('venue');
  const [page, setPage] = useState({ page: 1, perPage: 20 });
  const [action, setAction] = useState<{ b: Booking; type: 'reject' | 'cancel' } | null>(null);
  const [form] = Form.useForm<{ note: string }>();
  const base = kind === 'venue' ? '/venue-bookings' : '/resource-bookings';
  const params = { ...page, ...(view === 'event' ? { eventId } : { view }) };
  const list = useQuery({ queryKey: [`${kind}-bookings`, params], queryFn: () => api.getPage<Booking>(base, params), placeholderData: keepPreviousData });
  const refresh = () => {
    for (const k of ['venue-bookings', 'resource-bookings', 'venue-availability']) void qc.invalidateQueries({ queryKey: [k] });
  };
  const act = useMutation({
    mutationFn: ({ id, op, note }: { id: string; op: 'approve' | 'reject' | 'cancel'; note?: string }) => api.post(`${base}/${id}/${op}`, { note }),
    onSuccess: (_d, v) => {
      msg.success({ approve: 'อนุมัติแล้ว', reject: 'ไม่อนุมัติแล้ว', cancel: 'ยกเลิกแล้ว' }[v.op]);
      setAction(null);
      refresh();
    },
    onError: (e) => {
      msg.error(e);
      refresh();
    },
  });

  return (
    <>
      <Segmented
        style={{ marginBottom: 12 }}
        value={kind}
        onChange={(v) => {
          setKind(v as 'venue' | 'resource');
          setPage({ page: 1, perPage: 20 });
        }}
        options={[
          { value: 'venue', label: 'สถานที่' },
          { value: 'resource', label: 'อุปกรณ์' },
        ]}
      />
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <Table<Booking>
          rowKey="id"
          size="middle"
          loading={list.isFetching}
          dataSource={list.data?.items ?? []}
          scroll={{ x: 900 }}
          pagination={{ current: page.page, pageSize: page.perPage, total: list.data?.meta.total ?? 0, onChange: (p, pp) => setPage({ page: p, perPage: pp }) }}
          locale={{ emptyText: view === 'approve' ? 'ไม่มีคำขอที่รอการพิจารณา' : 'ไม่มีรายการ' }}
          columns={[
            {
              title: kind === 'venue' ? 'สถานที่' : 'อุปกรณ์',
              render: (_, b) => (
                <>
                  <div>{b.venue?.nameTh ?? `${b.resource?.nameTh} × ${b.quantity}`}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {b.venue?.code ?? b.resource?.code}
                  </Typography.Text>
                </>
              ),
            },
            {
              title: 'ช่วงเวลา',
              width: 230,
              render: (_, b) => (
                <>
                  <ThaiDate value={b.startAt} time />
                  <div style={{ fontSize: 13, color: '#6b7280' }}>
                    ถึง <ThaiDate value={b.endAt} time />
                  </div>
                </>
              ),
            },
            {
              title: 'เพื่อ',
              render: (_, b) => (
                <>
                  {b.event ? <Link href={`/admin/events/${b.event.id}`}>{b.event.titleTh}</Link> : b.purpose}
                  {b.requestedBy && <div style={{ fontSize: 12, color: '#6b7280' }}>ขอโดย {b.requestedBy.displayName}</div>}
                </>
              ),
            },
            {
              title: 'สถานะ',
              width: 180,
              render: (_, b) => (
                <>
                  <Tag color={BOOKING_STATUS[b.status].color}>{BOOKING_STATUS[b.status].label}</Tag>
                  {b.decisionNote && <div style={{ fontSize: 12, color: '#6b7280' }}>{b.decisionNote}</div>}
                  {b.decidedBy && <div style={{ fontSize: 12, color: '#9ca3af' }}>{b.decidedBy.displayName}</div>}
                </>
              ),
            },
            {
              title: '',
              width: 200,
              render: (_, b) => (
                <Space wrap>
                  {view === 'approve' && b.status === 'PENDING' && (
                    <>
                      <Button size="small" type="primary" icon={<CheckOutlined />} loading={act.isPending && act.variables?.id === b.id} onClick={() => act.mutate({ id: b.id, op: 'approve' })}>
                        อนุมัติ
                      </Button>
                      <Button
                        size="small"
                        danger
                        icon={<CloseOutlined />}
                        onClick={() => {
                          form.resetFields();
                          setAction({ b, type: 'reject' });
                        }}
                      >
                        ไม่อนุมัติ
                      </Button>
                    </>
                  )}
                  {view !== 'approve' && canCancel && ['PENDING', 'APPROVED'].includes(b.status) && new Date(b.endAt) > new Date() && (
                    <Button
                      size="small"
                      icon={<StopOutlined />}
                      onClick={() => {
                        form.resetFields();
                        setAction({ b, type: 'cancel' });
                      }}
                    >
                      ยกเลิก
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
      )}
      <Modal
        open={!!action}
        title={action?.type === 'reject' ? 'ไม่อนุมัติคำขอจอง' : 'ยกเลิกการจอง'}
        okText={action?.type === 'reject' ? 'ไม่อนุมัติ' : 'ยกเลิกการจอง'}
        cancelText="ปิด"
        okButtonProps={{ danger: true, loading: act.isPending }}
        onCancel={() => setAction(null)}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={(v) => act.mutate({ id: action!.b.id, op: action!.type, note: v.note })}>
          <Form.Item name="note" label="เหตุผล" rules={action?.type === 'reject' ? [{ required: true, min: 3, message: 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร' }] : []}>
            <Input.TextArea rows={2} maxLength={1000} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
