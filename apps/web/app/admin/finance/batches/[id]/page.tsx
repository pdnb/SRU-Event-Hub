'use client';

import { DownloadOutlined, FileDoneOutlined, FilePdfOutlined, InboxOutlined, RollbackOutlined, SendOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FinanceBatchDto } from '@sru/shared-types';
import { fiscalYearBE, formatReceiptNo, normalizeReceiptNo } from '@sru/shared-utils';
import { Alert, Button, Card, DatePicker, Descriptions, Form, Input, Modal, Popconfirm, Skeleton, Space, Table, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { use, useState } from 'react';
import { Money, ThaiDate } from '@/components/Format';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/QueryState';
import { StatusTag } from '@/components/StatusTag';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';
import dayjs, { DATE_FMT } from '@/services/dayjs';
import { downloadFile } from '@/services/download';

interface Item {
  id: string;
  isActive: boolean;
  paymentId: string;
  paymentNo: string;
  orderNo: string;
  referenceNo: string | null;
  payerName: string;
  amount: string;
  transferredAt: string | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
  /** FIN-10: group payment → one receipt in the organization's name + attendee list. */
  groupNo: string | null;
  memberCount: number | null;
  /** receiptNo is already formatted "<ปีงบ>/<เลขที่>" e.g. 2569/0001 (FIN-2). */
  receipt: { id: string; receiptNo: string; issuedAt: string } | null;
}
type Detail = FinanceBatchDto & { items: Item[] };

/** "000123" + 2 → "000125" (keeps zero padding). Non-numeric numbers are left for manual entry. */
const bump = (start: string, n: number) => {
  const s = normalizeReceiptNo(start);
  return s ? normalizeReceiptNo(String(Number(s) + n)) ?? '' : '';
};

export default function FinanceBatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState('');
  const [recording, setRecording] = useState(false);
  const [startNo, setStartNo] = useState('');
  const [issuedAt, setIssuedAt] = useState<Dayjs | null>(dayjs());

  const q = useQuery({ queryKey: ['finance-batch', id], queryFn: () => api.get<Detail>(`/finance/batches/${id}`) });
  const refresh = (text: string) => {
    msg.success(text);
    void qc.invalidateQueries({ queryKey: ['finance-batch', id] });
    void qc.invalidateQueries({ queryKey: ['finance-batches'] });
  };
  const act = useMutation({
    mutationFn: (a: 'submit' | 'receive') => api.post(`/finance/batches/${id}/${a}`),
    onSuccess: (_, a) => refresh(a === 'submit' ? 'ส่งชุดนำส่งให้กองคลังแล้ว' : 'บันทึกการรับชุดนำส่งแล้ว'),
    onError: msg.error,
  });
  const [voidingReceipt, setVoidingReceipt] = useState<Item | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const voidReceipt = useMutation({
    mutationFn: () => api.post(`/finance/batches/receipts/${voidingReceipt!.receipt!.id}/void`, { reason: voidReason }),
    onSuccess: () => {
      setVoidingReceipt(null);
      setVoidReason('');
      refresh('ยกเลิกเลขที่ใบเสร็จแล้ว บันทึกเลขใหม่ได้');
    },
    onError: msg.error,
  });
  const ret = useMutation({
    mutationFn: () => api.post(`/finance/batches/${id}/return`, { reason }),
    onSuccess: () => {
      setReturning(false);
      refresh('ส่งกลับให้หน่วยงานแก้ไขแล้ว');
    },
    onError: msg.error,
  });

  const pending = q.data?.items.filter((i) => i.isActive && !i.receipt) ?? [];
  const receiptFy = issuedAt ? fiscalYearBE(issuedAt.toDate()) : null;
  const receipts = pending.map((i, n) => ({ paymentId: i.paymentId, receiptNo: bump(startNo, n), issuedAt: issuedAt?.toISOString() ?? '' }));
  const record = useMutation({
    mutationFn: () => api.post<{ recorded: number; complete: boolean }>(`/finance/batches/${id}/receipts`, { receipts }),
    onSuccess: (r) => {
      setRecording(false);
      refresh(`บันทึกเลขที่ใบเสร็จ ${r.recorded} รายการ${r.complete ? ' ครบทุกรายการแล้ว' : ''}`);
    },
    onError: msg.error,
  });

  if (q.isPending) return <Card><Skeleton active /></Card>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const b = q.data;

  return (
    <>
      <PageHeader
        title={`ชุดนำส่ง ${b.batchNo}`}
        description={`${b.eventCode} ${b.eventTitle}`}
        breadcrumb={[{ title: 'การเงิน / กองคลัง' }, { title: 'ชุดนำส่งกองคลัง', href: '/admin/finance/batches' }, { title: b.batchNo }]}
        actions={
          <Space wrap>
            {can('finance_batch:export') && (
              <Button icon={<FilePdfOutlined />} onClick={() => downloadFile(`/finance/batches/${id}/export`, `${b.batchNo}.pdf`, { format: 'pdf' }).catch(msg.error)}>
                รายงานนำส่ง (PDF)
              </Button>
            )}
            {can('finance_batch:export') && (
              <Button icon={<DownloadOutlined />} onClick={() => downloadFile(`/finance/batches/${id}/export`, `${b.batchNo}.xlsx`, { format: 'xlsx' }).catch(msg.error)}>
                รายงานนำส่ง (Excel)
              </Button>
            )}
            {b.status === 'DRAFT' && can('finance_batch:submit') && (
              <Popconfirm title="ส่งชุดนำส่งให้กองคลัง?" description="หลังส่งแล้วจะแก้ไขรายการในชุดไม่ได้" okText="ส่ง" cancelText="ยกเลิก" onConfirm={() => act.mutate('submit')}>
                <Button type="primary" icon={<SendOutlined />} loading={act.isPending}>
                  ส่งกองคลัง
                </Button>
              </Popconfirm>
            )}
            {b.status === 'SUBMITTED' && can('finance_batch:receive') && (
              <>
                <Button danger icon={<RollbackOutlined />} onClick={() => setReturning(true)}>
                  ส่งกลับแก้ไข
                </Button>
                <Popconfirm title="ยืนยันรับชุดนำส่งและเงินถูกต้อง?" okText="รับชุดนำส่ง" cancelText="ยกเลิก" onConfirm={() => act.mutate('receive')}>
                  <Button type="primary" icon={<InboxOutlined />} loading={act.isPending}>
                    รับชุดนำส่ง
                  </Button>
                </Popconfirm>
              </>
            )}
            {b.status === 'RECEIVED' && can('receipt:create') && pending.length > 0 && (
              <Button type="primary" icon={<FileDoneOutlined />} onClick={() => setRecording(true)}>
                บันทึกเลขที่ใบเสร็จ
              </Button>
            )}
          </Space>
        }
      />
      {b.status === 'RETURNED' && <Alert style={{ marginBottom: 16 }} type="warning" showIcon title="กองคลังส่งกลับให้แก้ไข" description={`เหตุผล: ${b.returnReason ?? '-'} — รายการในชุดนี้ถูกปล่อยคืนเพื่อจัดทำชุดใหม่`} />}
      <Card>
        <Descriptions column={{ xs: 1, md: 2 }} size="small" bordered>
          <Descriptions.Item label="สถานะ">
            <StatusTag status={b.status} kind="batch" />
          </Descriptions.Item>
          <Descriptions.Item label="หน่วยงาน">{b.organizationName}</Descriptions.Item>
          <Descriptions.Item label="ยอดรวม">
            <Typography.Text strong>
              <Money value={b.totalAmount} />
            </Typography.Text>{' '}
            <Typography.Text type="secondary">({b.totalAmountText})</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="จำนวนรายการ / ใบเสร็จ">
            {b.itemCount} / {b.receiptCount}
          </Descriptions.Item>
          <Descriptions.Item label="จัดทำโดย">
            {b.createdByName} · <ThaiDate value={b.createdAt} time />
          </Descriptions.Item>
          <Descriptions.Item label="ส่งกองคลัง">
            <ThaiDate value={b.submittedAt} time />
          </Descriptions.Item>
          <Descriptions.Item label="กองคลังรับ">
            {b.receivedByName ? (
              <>
                {b.receivedByName} · <ThaiDate value={b.receivedAt} time />
              </>
            ) : (
              '-'
            )}
          </Descriptions.Item>
          <Descriptions.Item label="หมายเหตุ">{b.note ?? '-'}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Card title="รายการในชุดนำส่ง" style={{ marginTop: 16 }}>
        <Table<Item>
          rowKey="id"
          dataSource={b.items}
          pagination={false}
          scroll={{ x: 900 }}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={4} align="right">
                <strong>รวมทั้งสิ้น</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right">
                <strong>
                  <Money value={b.totalAmount} />
                </strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={2} colSpan={2} />
            </Table.Summary.Row>
          )}
          columns={[
            { title: 'ลำดับ', width: 60, render: (_, __, i) => i + 1 },
            { title: 'เลขที่รายการ', dataIndex: 'paymentNo', width: 150 },
            {
              title: 'ผู้ชำระ',
              render: (_, r) => (
                <>
                  {r.payerName}
                  <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.groupNo ? `กลุ่ม ${r.groupNo} · ${r.memberCount ?? 0} คน` : r.referenceNo}</Typography.Text></div>
                  {r.groupNo && can('finance_batch:export') && (
                    <Space size={0}>
                      <Button size="small" type="link" icon={<FilePdfOutlined />} style={{ paddingInline: 0 }} onClick={() => downloadFile(`/finance/batches/${id}/items/${r.paymentId}/attendees`, `${r.groupNo}-attendees.pdf`, { format: 'pdf' }).catch(msg.error)}>
                        รายชื่อแนบใบเสร็จ
                      </Button>
                      <Button size="small" type="link" aria-label="รายชื่อแนบใบเสร็จ (Excel)" icon={<DownloadOutlined />} onClick={() => downloadFile(`/finance/batches/${id}/items/${r.paymentId}/attendees`, `${r.groupNo}-attendees.xlsx`, { format: 'xlsx' }).catch(msg.error)} />
                    </Space>
                  )}
                </>
              ),
            },
            { title: 'ตรวจสอบโดย', render: (_, r) => <>{r.verifiedByName}<div><Typography.Text type="secondary" style={{ fontSize: 12 }}><ThaiDate value={r.verifiedAt} time /></Typography.Text></div></> },
            { title: 'จำนวนเงิน', dataIndex: 'amount', align: 'right', width: 130, render: (v: string) => <Money value={v} /> },
            {
              title: 'เลขที่ใบเสร็จ',
              width: 210,
              render: (_, r) =>
                r.receipt ? (
                  <Space size={4}>
                    {r.receipt.receiptNo}
                    {can('receipt:void') && ['RECEIVED', 'RECEIPTS_ISSUED'].includes(b.status) && (
                      <Button size="small" type="link" danger onClick={() => setVoidingReceipt(r)}>ยกเลิก</Button>
                    )}
                  </Space>
                ) : (
                  '-'
                ),
            },
            { title: 'วันที่ออกใบเสร็จ', width: 140, render: (_, r) => (r.receipt ? <ThaiDate value={r.receipt.issuedAt} /> : '-') },
          ]}
        />
      </Card>

      <Modal
        open={!!voidingReceipt}
        title={`ยกเลิกเลขที่ใบเสร็จ ${voidingReceipt?.receipt?.receiptNo ?? ''}`}
        okText="ยกเลิกใบเสร็จ"
        cancelText="ปิด"
        okButtonProps={{ danger: true, disabled: voidReason.trim().length < 3, loading: voidReceipt.isPending }}
        onOk={() => voidReceipt.mutate()}
        onCancel={() => setVoidingReceipt(null)}
      >
        <Typography.Paragraph>เลขที่เดิมจะถูกเก็บไว้พร้อมสถานะ &quot;ยกเลิก&quot; และชุดนำส่งจะกลับเป็น &quot;กองคลังรับแล้ว&quot; เพื่อบันทึกเลขที่ใหม่</Typography.Paragraph>
        <Input.TextArea rows={3} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="เหตุผล เช่น พิมพ์เลขผิด" maxLength={1000} showCount />
      </Modal>

      <Modal open={returning} title="ส่งชุดนำส่งกลับให้หน่วยงานแก้ไข" okText="ส่งกลับ" cancelText="ยกเลิก" okButtonProps={{ danger: true, disabled: reason.trim().length < 3, loading: ret.isPending }} onOk={() => ret.mutate()} onCancel={() => setReturning(false)}>
        <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผล เช่น ยอดเงินไม่ตรงกับเงินที่นำส่ง" maxLength={1000} showCount />
      </Modal>

      <Modal
        open={recording}
        title="บันทึกเลขที่ใบเสร็จ (ออกโดยกองคลัง)"
        okText={`บันทึก ${pending.length} รายการ`}
        cancelText="ยกเลิก"
        width={720}
        onCancel={() => setRecording(false)}
        onOk={() => record.mutate()}
        okButtonProps={{ disabled:!issuedAt || receipts.some((r) => !r.receiptNo), loading: record.isPending }}
        destroyOnHidden
      >
        <Form layout="vertical">
          <Space wrap align="start">
            <Form.Item
              label="เลขที่เริ่มต้น"
              required
              validateStatus={startNo && !normalizeReceiptNo(startNo) ? 'error' : undefined}
              help={startNo && !normalizeReceiptNo(startNo) ? 'กรอกเฉพาะตัวเลข เช่น 1 หรือ 0001' : 'ปีงบประมาณมาจากวันที่ออกใบเสร็จ รายการถัดไปเรียงเลขต่อกันอัตโนมัติ'}
            >
              <Input value={startNo} onChange={(e) => setStartNo(e.target.value)} style={{ width: 200 }} maxLength={10} addonBefore={receiptFy ? `${receiptFy}/` : undefined} placeholder="0001" inputMode="numeric" />
            </Form.Item>
            <Form.Item label="วันที่ออกใบเสร็จ" required>
              <DatePicker value={issuedAt} onChange={setIssuedAt} format={DATE_FMT} />
            </Form.Item>
          </Space>
        </Form>
        <Table
          size="small"
          rowKey="paymentId"
          pagination={false}
          dataSource={pending.map((i, n) => ({ ...i, no: receipts[n]!.receiptNo }))}
          columns={[
            { title: 'เลขที่รายการ', dataIndex: 'paymentNo' },
            { title: 'ผู้ชำระ', dataIndex: 'payerName' },
            { title: 'จำนวนเงิน', dataIndex: 'amount', align: 'right', render: (v: string) => <Money value={v} /> },
            { title: 'เลขที่ใบเสร็จ', render: (_, r) => (receiptFy && r.no ? formatReceiptNo(receiptFy, r.no) : '-') },
          ]}
        />
      </Modal>
    </>
  );
}
