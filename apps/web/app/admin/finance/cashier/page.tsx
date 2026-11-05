'use client';

import { PlusOutlined } from '@ant-design/icons';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import type { EventSummaryDto } from '@sru/shared-types';
import { Button, Card, Form, Input, Modal, Select, Table, Tabs, Typography } from 'antd';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Money, ThaiDate } from '@/components/Format';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/QueryState';
import { StatusTag } from '@/components/StatusTag';
import type { CashierSessionDto } from '@/features/finance/types';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';

const TABS = [
  { key: '', label: 'ทั้งหมด' },
  { key: 'OPEN', label: 'เปิดกะ' },
  { key: 'CLOSED', label: 'ปิดกะแล้ว' },
  { key: 'REMITTED', label: 'นำส่งแล้ว (รอยืนยัน)' },
  { key: 'CONFIRMED', label: 'ยืนยันยอดแล้ว' },
];

export default function CashierSessionsPage() {
  const can = useCan();
  const router = useRouter();
  const msg = useApiMessage();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [opening, setOpening] = useState(false);
  const [eventId, setEventId] = useState<string>();
  const [eventSearch, setEventSearch] = useState('');
  const [float, setFloat] = useState('0');

  const list = useQuery({
    queryKey: ['cashier-sessions', status, page],
    queryFn: () => api.getPage<CashierSessionDto>('/finance/cashier-sessions', { status: status || undefined, page, perPage: 20 }),
    placeholderData: keepPreviousData,
  });
  const events = useQuery({
    queryKey: ['admin-events', 'picker', eventSearch],
    queryFn: () => api.getPage<EventSummaryDto>('/events', { perPage: 50, search: eventSearch || undefined }),
    enabled: opening,
  });
  const open = useMutation({
    mutationFn: () => api.post<{ id: string; sessionNo: string }>('/finance/cashier-sessions', { eventId, openingFloat: float || '0' }),
    onSuccess: (s) => {
      msg.success(`เปิดกะ ${s.sessionNo} แล้ว`);
      setOpening(false);
      router.push(`/admin/finance/cashier/${s.id}`);
    },
    onError: msg.error,
  });

  return (
    <>
      <PageHeader
        title="รับชำระหน้างาน"
        description="เปิดกะ รับเงินสดตามใบแจ้งชำระ ปิดกะพร้อมนับเงิน และนำส่ง — การเงินหน่วยงานยืนยันยอดก่อนรวมเข้าชุดนำส่งกองคลัง"
        breadcrumb={[{ title: 'การเงิน / กองคลัง' }, { title: 'รับชำระหน้างาน' }]}
        actions={
          can('cashier:collect') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpening(true)}>
              เปิดกะรับเงิน
            </Button>
          )
        }
      />
      <Card>
        <Tabs activeKey={status} onChange={(k) => { setStatus(k); setPage(1); }} items={TABS} />
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : (
          <Table<CashierSessionDto>
            rowKey="id"
            loading={list.isFetching}
            dataSource={list.data?.items}
            scroll={{ x: 900 }}
            pagination={{ current: page, pageSize: 20, total: list.data?.meta.total, onChange: setPage, showSizeChanger: false }}
            columns={[
              { title: 'เลขที่กะ', dataIndex: 'sessionNo', width: 150, render: (v: string, r) => <Link href={`/admin/finance/cashier/${r.id}`}>{v}</Link> },
              { title: 'กิจกรรม', render: (_, r) => <>{r.eventTitle}<div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.eventCode}</Typography.Text></div></> },
              { title: 'ผู้รับเงิน', dataIndex: 'cashierName', width: 170 },
              { title: 'รายการ', dataIndex: 'paymentCount', align: 'right', width: 80 },
              { title: 'ยอดรับ', dataIndex: 'collectedAmount', align: 'right', width: 130, render: (v: string) => <Money value={v} /> },
              { title: 'ส่วนต่าง', dataIndex: 'difference', align: 'right', width: 120, render: (v: string | null) => (v && v !== '0.00' ? <Typography.Text type="danger"><Money value={v} /></Typography.Text> : '-') },
              { title: 'สถานะ', dataIndex: 'status', width: 140, render: (v: string) => <StatusTag status={v} kind="cashier" /> },
              { title: 'เปิดกะ', dataIndex: 'openedAt', width: 160, render: (v: string) => <ThaiDate value={v} time /> },
            ]}
          />
        )}
      </Card>

      <Modal
        open={opening}
        title="เปิดกะรับเงินหน้างาน"
        okText="เปิดกะ"
        cancelText="ยกเลิก"
        onCancel={() => setOpening(false)}
        onOk={() => open.mutate()}
        okButtonProps={{ disabled: !eventId, loading: open.isPending }}
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label="กิจกรรม" required>
            <Select
              showSearch={{ filterOption: false, onSearch: setEventSearch }}
              placeholder="เลือกกิจกรรมที่มีค่าลงทะเบียน"
              value={eventId}
              onChange={setEventId}
              loading={events.isFetching}
              options={events.data?.items.filter((e) => e.isPaid).map((e) => ({ value: e.id, label: `${e.code} · ${e.titleTh}` }))}
            />
          </Form.Item>
          <Form.Item label="เงินทอนตั้งต้น (บาท)" help="ไม่นับเป็นรายได้ ใช้ตรวจนับเงินในลิ้นชักตอนปิดกะ">
            <Input inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} style={{ textAlign: 'right', maxWidth: 200 }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
