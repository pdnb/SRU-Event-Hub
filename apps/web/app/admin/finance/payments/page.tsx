'use client';

import { CheckOutlined, CloseOutlined, SearchOutlined } from '@ant-design/icons';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EventSummaryDto, FinancePaymentRowDto } from '@sru/shared-types';
import { Alert, Button, Card, Descriptions, Drawer, Empty, Flex, Input, Modal, Popconfirm, Select, Space, Spin, Table, Tabs, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { Money, ThaiDate } from '@/components/Format';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/QueryState';
import { StatusTag } from '@/components/StatusTag';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';
import { fetchObjectUrl } from '@/services/download';

const TABS = [
  { key: 'SUBMITTED', label: 'รอตรวจสอบ' },
  { key: 'VERIFIED', label: 'ตรวจสอบแล้ว' },
  { key: 'REJECTED', label: 'ไม่ผ่าน' },
  { key: 'VOIDED', label: 'ยกเลิกรายการ' },
  { key: '', label: 'ทั้งหมด' },
];

function SlipPreview({ paymentId }: { paymentId: string }) {
  const [file, setFile] = useState<{ url: string; type: string } | null>(null);
  const [error, setError] = useState(false);
  // Mounted with key={paymentId}, so state starts fresh for every slip.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    fetchObjectUrl(`/finance/payments/${paymentId}/slip`)
      .then((f) => {
        objectUrl = f.url;
        if (cancelled) URL.revokeObjectURL(f.url);
        else setFile(f);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [paymentId]);
  if (error) return <Alert type="error" title="ไม่สามารถโหลดหลักฐานการโอนได้" />;
  if (!file) return <Spin />;
  return file.type === 'application/pdf' ? (
    <iframe src={file.url} title="หลักฐานการโอน" style={{ width: '100%', height: 520, border: 0 }} />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={file.url} alt="หลักฐานการโอนเงิน" style={{ maxWidth: '100%', maxHeight: 560, display: 'block', margin: '0 auto' }} />
  );
}

/**
 * Slip verification queue (spec §4.7). Reviewers only see payments of organizations in their data
 * scope; separation of duties (reviewer ≠ payer) is enforced by the API.
 */
export default function FinancePaymentsPage() {
  const can = useCan();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const [status, setStatus] = useState('SUBMITTED');
  const [eventId, setEventId] = useState<string>();
  const [eventSearch, setEventSearch] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<FinancePaymentRowDto | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const events = useQuery({
    queryKey: ['admin-events', 'picker', eventSearch],
    queryFn: () => api.getPage<EventSummaryDto>('/events', { perPage: 50, search: eventSearch || undefined }),
  });
  const list = useQuery({
    queryKey: ['finance-payments', status, eventId, search, page],
    queryFn: () => api.getPage<FinancePaymentRowDto>('/finance/payments', { status: status || undefined, eventId, search: search || undefined, page, perPage: 20, order: status === 'SUBMITTED' ? 'asc' : 'desc' }),
    placeholderData: keepPreviousData,
  });

  const done = (text: string) => {
    msg.success(text);
    setOpen(null);
    setRejecting(false);
    setReason('');
    void qc.invalidateQueries({ queryKey: ['finance-payments'] });
  };
  const verify = useMutation({ mutationFn: (id: string) => api.post(`/finance/payments/${id}/verify`), onSuccess: () => done('ยืนยันการชำระเงินแล้ว'), onError: msg.error });
  const reject = useMutation({ mutationFn: (id: string) => api.post(`/finance/payments/${id}/reject`, { reason }), onSuccess: () => done('แจ้งหลักฐานไม่ผ่านแล้ว'), onError: msg.error });

  return (
    <>
      <PageHeader title="ตรวจสอบการชำระเงิน" description="ตรวจสอบหลักฐานการโอนเงินกับรายการเงินเข้าบัญชีก่อนยืนยัน — ยอดเงินกำหนดโดยระบบจากอัตราค่าลงทะเบียน" breadcrumb={[{ title: 'การชำระเงิน' }]} />
      <Card>
        <Flex gap={12} wrap style={{ marginBottom: 12 }}>
          <Select
            allowClear
            showSearch={{ filterOption: false, onSearch: setEventSearch }}
            style={{ minWidth: 320, flex: 1, maxWidth: 560 }}
            placeholder="ทุกกิจกรรม"
            value={eventId}
            onChange={(v) => {
              setEventId(v);
              setPage(1);
            }}
            options={events.data?.items.filter((e) => e.isPaid).map((e) => ({ value: e.id, label: `${e.code} · ${e.titleTh}` }))}
          />
          <Input.Search
            allowClear
            prefix={<SearchOutlined />}
            placeholder="ชื่อผู้ชำระ / อีเมล / เลขอ้างอิง / PAY- / INV-"
            style={{ maxWidth: 360 }}
            onSearch={(v) => {
              setSearch(v.trim());
              setPage(1);
            }}
          />
        </Flex>
        <Tabs
          activeKey={status}
          onChange={(k) => {
            setStatus(k);
            setPage(1);
          }}
          items={TABS.map((t) => ({ key: t.key, label: t.label }))}
        />
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : (
          <Table<FinancePaymentRowDto>
            rowKey="id"
            loading={list.isFetching}
            dataSource={list.data?.items}
            scroll={{ x: 1000 }}
            locale={{ emptyText: <Empty description={status === 'SUBMITTED' ? 'ไม่มีรายการรอตรวจสอบ' : 'ไม่พบรายการ'} /> }}
            pagination={{ current: page, pageSize: 20, total: list.data?.meta.total, onChange: setPage, showSizeChanger: false }}
            onRow={(r) => ({ onClick: () => setOpen(r), style: { cursor: 'pointer' } })}
            columns={[
              { title: 'เลขที่รายการ', dataIndex: 'paymentNo', width: 150 },
              {
                title: 'ผู้ชำระ',
                render: (_, r) => (
                  <>
                    <div>{r.payerName}</div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {r.referenceNo} · {r.orderNo}
                    </Typography.Text>
                  </>
                ),
              },
              { title: 'กิจกรรม', render: (_, r) => <Typography.Text ellipsis style={{ maxWidth: 240 }}>{r.eventTitle}</Typography.Text> },
              { title: 'จำนวนเงิน', dataIndex: 'amount', align: 'right', width: 130, render: (v: string) => <Money value={v} /> },
              { title: 'วันเวลาที่โอน', dataIndex: 'transferredAt', width: 160, render: (v: string | null) => <ThaiDate value={v} time /> },
              { title: 'ส่งหลักฐานเมื่อ', dataIndex: 'submittedAt', width: 160, render: (v: string) => <ThaiDate value={v} time /> },
              { title: 'สถานะ', dataIndex: 'status', width: 130, render: (v: string) => <StatusTag status={v} kind="payment" /> },
              { title: 'ชุดนำส่ง / ใบเสร็จ', width: 170, render: (_, r) => (r.batchNo ? <>{r.batchNo}{r.receiptNo ? <div>{r.receiptNo}</div> : null}</> : '-') },
            ]}
          />
        )}
      </Card>

      <Drawer open={!!open} onClose={() => setOpen(null)} size={720} title={open ? `${open.paymentNo} · ${open.payerName}` : ''} destroyOnHidden>
        {open && (
          <>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="กิจกรรม">
                {open.eventCode} {open.eventTitle}
              </Descriptions.Item>
              <Descriptions.Item label="ผู้ชำระ">
                {open.payerName} ({open.payerEmail})
              </Descriptions.Item>
              <Descriptions.Item label="เลขอ้างอิง / ใบแจ้งชำระ">
                {open.referenceNo} / {open.orderNo}
              </Descriptions.Item>
              <Descriptions.Item label="ยอดที่ต้องชำระ">
                <Typography.Text strong style={{ fontSize: 18 }}>
                  <Money value={open.amount} />
                </Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="วันเวลาที่โอน (ผู้ชำระระบุ)">
                <ThaiDate value={open.transferredAt} time />
              </Descriptions.Item>
              <Descriptions.Item label="สถานะ">
                <StatusTag status={open.status} kind="payment" /> {open.verifiedByName && <Typography.Text type="secondary">โดย {open.verifiedByName} <ThaiDate value={open.verifiedAt} time /></Typography.Text>}
              </Descriptions.Item>
              {open.rejectReason && <Descriptions.Item label="เหตุผลที่ไม่ผ่าน">{open.rejectReason}</Descriptions.Item>}
            </Descriptions>
            <Card size="small" title="หลักฐานการโอนเงิน" style={{ marginTop: 16 }}>
              {open.hasSlip ? <SlipPreview key={open.id} paymentId={open.id} /> : <Typography.Text type="secondary">ไม่มีไฟล์แนบ</Typography.Text>}
            </Card>
            {open.status === 'SUBMITTED' && can('payment:verify') && (
              <Flex justify="flex-end" gap={8} style={{ marginTop: 16 }}>
                <Button danger icon={<CloseOutlined />} onClick={() => setRejecting(true)}>
                  ไม่ผ่าน
                </Button>
                <Popconfirm
                  title="ยืนยันว่าได้รับเงินถูกต้อง?"
                  description={`ตรวจสอบยอด ${open.amount} บาท กับรายการเงินเข้าบัญชีแล้ว`}
                  okText="ยืนยันการชำระเงิน"
                  cancelText="ยกเลิก"
                  onConfirm={() => verify.mutate(open.id)}
                >
                  <Button type="primary" icon={<CheckOutlined />} loading={verify.isPending}>
                    ยืนยันการชำระเงิน
                  </Button>
                </Popconfirm>
              </Flex>
            )}
          </>
        )}
      </Drawer>

      <Modal
        open={rejecting}
        title="หลักฐานการชำระเงินไม่ผ่าน"
        okText="บันทึก"
        cancelText="ยกเลิก"
        okButtonProps={{ danger: true, disabled: reason.trim().length < 3, loading: reject.isPending }}
        onOk={() => open && reject.mutate(open.id)}
        onCancel={() => setRejecting(false)}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text>เหตุผล (ผู้ชำระจะเห็นข้อความนี้ และได้รับเวลาเพิ่มอย่างน้อย 24 ชั่วโมงเพื่อแนบหลักฐานใหม่)</Typography.Text>
          <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} showCount placeholder="เช่น ยอดเงินไม่ตรง, ไม่พบรายการเงินเข้าบัญชี" />
        </Space>
      </Modal>
    </>
  );
}
