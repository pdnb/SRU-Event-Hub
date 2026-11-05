'use client';

import { CheckOutlined, CloseOutlined, EyeOutlined, PlusOutlined, SwapOutlined } from '@ant-design/icons';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Descriptions, Form, Input, Modal, Select, Space, Table, Tabs, Typography } from 'antd';
import { useState } from 'react';
import { Money, ThaiDate } from '@/components/Format';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/QueryState';
import { StatusTag } from '@/components/StatusTag';
import type { RefundableDto, RefundDto } from '@/features/finance/types';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan, useMe } from '@/hooks/useMe';
import { api } from '@/services/api';

const TABS = [
  { key: 'REQUESTED', label: 'รอพิจารณา' },
  { key: 'APPROVED', label: 'รอจ่ายคืน' },
  { key: 'PAID', label: 'คืนเงินแล้ว' },
  { key: 'REJECTED', label: 'ไม่อนุมัติ' },
  { key: '', label: 'ทั้งหมด' },
];

interface CreateForm {
  orderId: string;
  amount: string;
  reason: string;
  payeeName: string;
  bankName: string;
  accountNo: string;
}

/**
 * คืนเงิน: การเงินหน่วยงาน/กองคลังยื่นคำขอ → กองคลังอนุมัติ → จ่ายคืนและบันทึกเลขอ้างอิงการโอน.
 * Requester ≠ approver ≠ payer is enforced by the API; the UI only hides buttons.
 */
export default function RefundsPage() {
  const can = useCan();
  const me = useMe();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const [status, setStatus] = useState('REQUESTED');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [orderSearch, setOrderSearch] = useState('');
  const [form] = Form.useForm<CreateForm>();
  const [rejecting, setRejecting] = useState<RefundDto | null>(null);
  const [reason, setReason] = useState('');
  const [paying, setPaying] = useState<RefundDto | null>(null);
  const [paidRef, setPaidRef] = useState('');
  const [account, setAccount] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['refunds', status, page],
    queryFn: () => api.getPage<RefundDto>('/finance/refunds', { status: status || undefined, page, perPage: 20 }),
    placeholderData: keepPreviousData,
  });
  const refundable = useQuery({
    queryKey: ['refundable', orderSearch],
    queryFn: () => api.get<RefundableDto[]>('/finance/refunds/refundable', { search: orderSearch || undefined }),
    enabled: creating,
  });
  const selectedOrderId = Form.useWatch('orderId', form);
  const selected = refundable.data?.find((o) => o.orderId === selectedOrderId);

  const done = (text: string) => {
    msg.success(text);
    void qc.invalidateQueries({ queryKey: ['refunds'] });
  };
  const create = useMutation({
    mutationFn: (v: CreateForm) => api.post<{ refundNo: string }>('/finance/refunds', v),
    onSuccess: (r) => { setCreating(false); form.resetFields(); done(`ยื่นคำขอคืนเงิน ${r.refundNo} แล้ว`); },
    onError: msg.error,
  });
  const approve = useMutation({ mutationFn: (id: string) => api.post(`/finance/refunds/${id}/approve`), onSuccess: () => done('อนุมัติแล้ว'), onError: msg.error });
  const reject = useMutation({
    mutationFn: () => api.post(`/finance/refunds/${rejecting!.id}/reject`, { reason }),
    onSuccess: () => { setRejecting(null); setReason(''); done('ไม่อนุมัติคำขอแล้ว'); },
    onError: msg.error,
  });
  const reveal = useMutation({
    mutationFn: (id: string) => api.post<{ accountNo: string }>(`/finance/refunds/${id}/reveal-account`),
    onSuccess: (r) => setAccount(r.accountNo),
    onError: msg.error,
  });
  const pay = useMutation({
    mutationFn: () => api.post(`/finance/refunds/${paying!.id}/pay`, { paidRef }),
    onSuccess: () => { setPaying(null); setPaidRef(''); setAccount(null); done('บันทึกการจ่ายคืนแล้ว'); },
    onError: msg.error,
  });

  const notMine = (r: RefundDto) => r.requestedById !== me.data?.id;

  return (
    <>
      <PageHeader
        title="คืนเงิน"
        description="ยื่นคำขอ อนุมัติ และบันทึกการโอนคืน — ผู้ขอ ผู้อนุมัติ และผู้จ่ายคืนต้องเป็นคนละคน เลขบัญชีผู้รับเงินถูกเข้ารหัสและแสดงแบบปิดบัง"
        breadcrumb={[{ title: 'การเงิน / กองคลัง' }, { title: 'คืนเงิน' }]}
        actions={can('refund:create') && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>ยื่นคำขอคืนเงิน</Button>}
      />
      <Card>
        <Tabs activeKey={status} onChange={(k) => { setStatus(k); setPage(1); }} items={TABS} />
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : (
          <Table<RefundDto>
            rowKey="id"
            loading={list.isFetching}
            dataSource={list.data?.items}
            scroll={{ x: 1100 }}
            pagination={{ current: page, pageSize: 20, total: list.data?.meta.total, onChange: setPage, showSizeChanger: false }}
            expandable={{
              expandedRowRender: (r) => (
                <Descriptions size="small" column={{ xs: 1, md: 2 }}>
                  <Descriptions.Item label="เหตุผล">{r.reason}</Descriptions.Item>
                  <Descriptions.Item label="กิจกรรม">{r.eventCode} {r.eventTitle}</Descriptions.Item>
                  <Descriptions.Item label="ผู้ขอ">{r.requestedByName} · <ThaiDate value={r.createdAt} time /></Descriptions.Item>
                  <Descriptions.Item label="ผู้พิจารณา">{r.decidedByName ? <>{r.decidedByName} · <ThaiDate value={r.decidedAt} time /></> : '-'}</Descriptions.Item>
                  {r.rejectReason && <Descriptions.Item label="เหตุผลที่ไม่อนุมัติ">{r.rejectReason}</Descriptions.Item>}
                  {r.paidRef && <Descriptions.Item label="อ้างอิงการโอนคืน">{r.paidRef} · <ThaiDate value={r.paidAt} time /></Descriptions.Item>}
                </Descriptions>
              ),
            }}
            columns={[
              { title: 'เลขที่', dataIndex: 'refundNo', width: 140 },
              { title: 'ผู้รับเงินคืน', render: (_, r) => <>{r.payeeName}<div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.bankName} {r.accountNoMasked}</Typography.Text></div></> },
              { title: 'อ้างอิง', render: (_, r) => <>{r.referenceNo}<div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.orderNo}</Typography.Text></div></> },
              { title: 'จำนวนเงิน', dataIndex: 'amount', align: 'right', width: 130, render: (v: string) => <Money value={v} /> },
              { title: 'สถานะ', dataIndex: 'status', width: 170, render: (v: string) => <StatusTag status={v} kind="refund" /> },
              {
                title: '',
                width: 230,
                render: (_, r) => (
                  <Space wrap>
                    {r.status === 'REQUESTED' && can('refund:approve') && notMine(r) && (
                      <>
                        <Button size="small" type="primary" icon={<CheckOutlined />} loading={approve.isPending && approve.variables === r.id} onClick={() => approve.mutate(r.id)}>อนุมัติ</Button>
                        <Button size="small" danger icon={<CloseOutlined />} onClick={() => setRejecting(r)}>ไม่อนุมัติ</Button>
                      </>
                    )}
                    {r.status === 'APPROVED' && can('refund:refund') && notMine(r) && (
                      <Button size="small" type="primary" icon={<SwapOutlined />} onClick={() => { setAccount(null); setPaying(r); }}>บันทึกการโอนคืน</Button>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Modal open={creating} title="ยื่นคำขอคืนเงิน" okText="ยื่นคำขอ" cancelText="ยกเลิก" width={640} onCancel={() => setCreating(false)} onOk={() => form.submit()} confirmLoading={create.isPending} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)} preserve={false}>
          <Form.Item name="orderId" label="รายการที่ชำระแล้ว" rules={[{ required: true, message: 'กรุณาเลือกรายการ' }]}>
            <Select
              showSearch={{ filterOption: false, onSearch: setOrderSearch }}
              placeholder="ค้นหาชื่อ / REG- / INV-"
              loading={refundable.isFetching}
              options={refundable.data?.map((o) => ({ value: o.orderId, label: `${o.referenceNo ?? o.orderNo} · ${o.payerName} · ${o.eventCode} (คืนได้ ${o.refundable} บาท)` }))}
              onChange={(v) => {
                const o = refundable.data?.find((x) => x.orderId === v);
                if (o) form.setFieldsValue({ amount: o.refundable, payeeName: o.payerName });
              }}
            />
          </Form.Item>
          {selected?.registrationStatus === 'CONFIRMED' && (
            <Alert type="warning" showIcon style={{ marginBottom: 12 }} title="การลงทะเบียนนี้ยังยืนยันอยู่" description="การคืนเงินไม่ยกเลิกการลงทะเบียนให้อัตโนมัติ — หากต้องการยกเลิกสิทธิ์ ให้ยกเลิกการลงทะเบียนด้วย" />
          )}
          <Form.Item name="amount" label="จำนวนเงินคืน (บาท)" rules={[{ required: true, pattern: /^\d{1,10}(\.\d{1,2})?$/, message: 'จำนวนเงินไม่ถูกต้อง' }]} extra={selected && <>ชำระแล้ว <Money value={selected.paid} /> · คืนได้สูงสุด <Money value={selected.refundable} /></>}>
            <Input inputMode="decimal" style={{ maxWidth: 200, textAlign: 'right' }} />
          </Form.Item>
          <Form.Item name="reason" label="เหตุผล" rules={[{ required: true, min: 3 }]}>
            <Input.TextArea rows={2} maxLength={1000} />
          </Form.Item>
          <Form.Item name="payeeName" label="ชื่อบัญชีผู้รับเงินคืน" rules={[{ required: true, min: 2 }]}>
            <Input />
          </Form.Item>
          <Space wrap>
            <Form.Item name="bankName" label="ธนาคาร" rules={[{ required: true, min: 2 }]}>
              <Input style={{ width: 220 }} />
            </Form.Item>
            <Form.Item name="accountNo" label="เลขที่บัญชี" rules={[{ required: true, pattern: /^[\d-]{6,20}$/, message: 'ตัวเลขและขีด 6–20 ตัว' }]}>
              <Input style={{ width: 220 }} autoComplete="off" />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      <Modal open={!!rejecting} title={`ไม่อนุมัติ ${rejecting?.refundNo ?? ''}`} okText="ไม่อนุมัติ" cancelText="ยกเลิก" onCancel={() => setRejecting(null)} onOk={() => reject.mutate()} okButtonProps={{ danger: true, disabled: reason.trim().length < 3, loading: reject.isPending }}>
        <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผล" maxLength={1000} showCount />
      </Modal>

      <Modal open={!!paying} title={`บันทึกการโอนคืน ${paying?.refundNo ?? ''}`} okText="บันทึก" cancelText="ยกเลิก" onCancel={() => { setPaying(null); setAccount(null); }} onOk={() => pay.mutate()} okButtonProps={{ disabled: paidRef.trim().length < 3, loading: pay.isPending }} destroyOnHidden>
        {paying && (
          <Descriptions column={1} size="small" bordered style={{ marginBottom: 12 }}>
            <Descriptions.Item label="จำนวนเงิน"><strong><Money value={paying.amount} /></strong> ({paying.amountText})</Descriptions.Item>
            <Descriptions.Item label="ผู้รับ">{paying.payeeName}</Descriptions.Item>
            <Descriptions.Item label="บัญชี">
              {paying.bankName} {account ? <Typography.Text copyable strong>{account}</Typography.Text> : paying.accountNoMasked}{' '}
              {!account && <Button size="small" icon={<EyeOutlined />} loading={reveal.isPending} onClick={() => reveal.mutate(paying.id)}>แสดงเลขบัญชี</Button>}
            </Descriptions.Item>
          </Descriptions>
        )}
        <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>การแสดงเลขบัญชีเต็มถูกบันทึกใน Audit log</Typography.Paragraph>
        <Input placeholder="เลขอ้างอิงการโอน (จากธนาคาร)" value={paidRef} onChange={(e) => setPaidRef(e.target.value)} maxLength={100} />
      </Modal>
    </>
  );
}
