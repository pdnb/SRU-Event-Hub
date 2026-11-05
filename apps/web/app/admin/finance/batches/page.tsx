'use client';

import { PlusOutlined } from '@ant-design/icons';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EventSummaryDto, FinanceBatchDto } from '@sru/shared-types';
import { Alert, Button, Card, Descriptions, Input, Modal, Select, Table, Tabs, Typography } from 'antd';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Money, ThaiDate } from '@/components/Format';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/QueryState';
import { StatusTag } from '@/components/StatusTag';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';

interface Eligible {
  event: { id: string; code: string; titleTh: string };
  count: number;
  totalAmount: string;
  payments: { id: string; paymentNo: string; payerName: string; amount: string }[];
}

const TABS = [
  { key: '', label: 'ทั้งหมด' },
  { key: 'DRAFT', label: 'ฉบับร่าง' },
  { key: 'SUBMITTED', label: 'ส่งกองคลังแล้ว' },
  { key: 'RECEIVED', label: 'กองคลังรับแล้ว' },
  { key: 'RECEIPTS_ISSUED', label: 'ออกใบเสร็จแล้ว' },
  { key: 'RETURNED', label: 'ส่งกลับแก้ไข' },
];

export default function FinanceBatchesPage() {
  const can = useCan();
  const router = useRouter();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [eventId, setEventId] = useState<string>();
  const [eventSearch, setEventSearch] = useState('');
  const [note, setNote] = useState('');

  const list = useQuery({
    queryKey: ['finance-batches', status, page],
    queryFn: () => api.getPage<FinanceBatchDto>('/finance/batches', { status: status || undefined, page, perPage: 20 }),
    placeholderData: keepPreviousData,
  });
  const events = useQuery({
    queryKey: ['admin-events', 'picker', eventSearch],
    queryFn: () => api.getPage<EventSummaryDto>('/events', { perPage: 50, search: eventSearch || undefined }),
    enabled: creating,
  });
  const eligible = useQuery({
    queryKey: ['batch-eligible', eventId],
    queryFn: () => api.get<Eligible>('/finance/batches/eligible', { eventId }),
    enabled: !!eventId,
  });
  const create = useMutation({
    mutationFn: () => api.post<{ id: string; batchNo: string }>('/finance/batches', { eventId, note: note || undefined }),
    onSuccess: (b) => {
      msg.success(`สร้างชุดนำส่ง ${b.batchNo} แล้ว`);
      setCreating(false);
      void qc.invalidateQueries({ queryKey: ['finance-batches'] });
      router.push(`/admin/finance/batches/${b.id}`);
    },
    onError: msg.error,
  });

  return (
    <>
      <PageHeader
        title="ชุดนำส่งกองคลัง"
        description="รวบรวมรายการชำระเงินที่ตรวจสอบแล้วเป็นชุด ส่งให้กองคลังรับเงินและออกใบเสร็จ (ระบบไม่ออกใบเสร็จเอง)"
        breadcrumb={[{ title: 'การเงิน / กองคลัง' }, { title: 'ชุดนำส่งกองคลัง' }]}
        actions={
          can('finance_batch:create') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              สร้างชุดนำส่ง
            </Button>
          )
        }
      />
      <Card>
        <Tabs activeKey={status} onChange={(k) => { setStatus(k); setPage(1); }} items={TABS} />
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : (
          <Table<FinanceBatchDto>
            rowKey="id"
            loading={list.isFetching}
            dataSource={list.data?.items}
            scroll={{ x: 900 }}
            pagination={{ current: page, pageSize: 20, total: list.data?.meta.total, onChange: setPage, showSizeChanger: false }}
            columns={[
              { title: 'เลขที่ชุด', dataIndex: 'batchNo', width: 150, render: (v: string, r) => <Link href={`/admin/finance/batches/${r.id}`}>{v}</Link> },
              {
                title: 'กิจกรรม',
                render: (_, r) => (
                  <>
                    <div>{r.eventTitle}</div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {r.eventCode} · {r.organizationName}
                    </Typography.Text>
                  </>
                ),
              },
              { title: 'รายการ', dataIndex: 'itemCount', align: 'right', width: 80 },
              { title: 'ยอดรวม', dataIndex: 'totalAmount', align: 'right', width: 140, render: (v: string) => <Money value={v} /> },
              { title: 'ใบเสร็จ', width: 90, align: 'right', render: (_, r) => `${r.receiptCount}/${r.itemCount}` },
              { title: 'สถานะ', dataIndex: 'status', width: 140, render: (v: string) => <StatusTag status={v} /> },
              { title: 'จัดทำ', width: 180, render: (_, r) => <>{r.createdByName}<div><Typography.Text type="secondary" style={{ fontSize: 12 }}><ThaiDate value={r.createdAt} time /></Typography.Text></div></> },
            ]}
          />
        )}
      </Card>

      <Modal
        open={creating}
        title="สร้างชุดนำส่งกองคลัง"
        okText="สร้างชุดนำส่ง"
        cancelText="ยกเลิก"
        onCancel={() => setCreating(false)}
        onOk={() => create.mutate()}
        okButtonProps={{ disabled: !eligible.data?.count, loading: create.isPending }}
        width={640}
        destroyOnHidden
      >
        <Select
          showSearch={{ filterOption: false, onSearch: setEventSearch }}
          style={{ width: '100%', marginBottom: 12 }}
          placeholder="เลือกกิจกรรมที่มีค่าลงทะเบียน"
          value={eventId}
          onChange={setEventId}
          loading={events.isFetching}
          options={events.data?.items.filter((e) => e.isPaid).map((e) => ({ value: e.id, label: `${e.code} · ${e.titleTh}` }))}
        />
        {eligible.isError && <ErrorState error={eligible.error} />}
        {eligible.data &&
          (eligible.data.count ? (
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="รายการที่ตรวจสอบแล้วและยังไม่ได้นำส่ง">{eligible.data.count} รายการ</Descriptions.Item>
              <Descriptions.Item label="ยอดรวม">
                <Typography.Text strong>
                  <Money value={eligible.data.totalAmount} />
                </Typography.Text>
              </Descriptions.Item>
            </Descriptions>
          ) : (
            <Alert type="info" showIcon title="ไม่มีรายการที่พร้อมนำส่ง" description="ต้องมีรายการชำระเงินที่ตรวจสอบแล้วและยังไม่อยู่ในชุดนำส่งอื่น" />
          ))}
        <Input.TextArea style={{ marginTop: 12 }} rows={2} placeholder="หมายเหตุ (ถ้ามี)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </Modal>
    </>
  );
}
