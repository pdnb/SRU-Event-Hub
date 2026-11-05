'use client';

import { CheckCircleOutlined, LockOutlined, PrinterOutlined, SearchOutlined, SendOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { newIdempotencyKey } from '@sru/api-client';
import { Alert, Button, Card, Col, Descriptions, Empty, Form, Input, Modal, Popconfirm, Row, Skeleton, Space, Statistic, Table, Typography } from 'antd';
import { List } from '@/components/SimpleList';
import { use, useState } from 'react';
import { Money, ThaiDate } from '@/components/Format';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/QueryState';
import { StatusTag } from '@/components/StatusTag';
import type { CashierSessionDto, CashPaymentDto, PayableDto } from '@/features/finance/types';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan, useMe } from '@/hooks/useMe';
import { api } from '@/services/api';

type Detail = CashierSessionDto & { payments: CashPaymentDto[] };
interface Collected {
  paymentNo: string;
  amount: string;
  amountText: string;
  orderNo: string;
  payerName: string;
  referenceNo: string | null;
  submittedAt: string;
}

/** Proof of payment slip for the payer (explicitly NOT an official receipt). */
function ProofOfPayment({ p, session }: { p: Collected; session: Detail }) {
  return (
    <div id="proof-of-payment">
      <Typography.Title level={5} style={{ textAlign: 'center', marginBottom: 4 }}>
        หลักฐานการชำระเงิน
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
        (ไม่ใช่ใบเสร็จรับเงิน — ใบเสร็จออกโดยกองคลัง มหาวิทยาลัยราชภัฏสุราษฎร์ธานี)
      </Typography.Paragraph>
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="เลขที่รายการ">{p.paymentNo}</Descriptions.Item>
        <Descriptions.Item label="กิจกรรม">{session.eventCode} {session.eventTitle}</Descriptions.Item>
        <Descriptions.Item label="ผู้ชำระ">{p.payerName}</Descriptions.Item>
        <Descriptions.Item label="เลขอ้างอิง / ใบแจ้งชำระ">{p.referenceNo} / {p.orderNo}</Descriptions.Item>
        <Descriptions.Item label="จำนวนเงิน">
          <strong><Money value={p.amount} /></strong> ({p.amountText})
        </Descriptions.Item>
        <Descriptions.Item label="วันเวลา"><ThaiDate value={p.submittedAt} time /></Descriptions.Item>
        <Descriptions.Item label="ผู้รับเงิน">{session.cashierName} ({session.sessionNo})</Descriptions.Item>
      </Descriptions>
    </div>
  );
}

export default function CashierSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const me = useMe();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const [search, setSearch] = useState('');
  const [collected, setCollected] = useState<Collected | null>(null);
  const [closing, setClosing] = useState(false);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [remitting, setRemitting] = useState(false);
  const [remittanceNo, setRemittanceNo] = useState('');
  const [voiding, setVoiding] = useState<CashPaymentDto | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const q = useQuery({ queryKey: ['cashier-session', id], queryFn: () => api.get<Detail>(`/finance/cashier-sessions/${id}`) });
  const s = q.data;
  const mine = !!s && s.cashierId === me.data?.id;
  const payables = useQuery({
    queryKey: ['cashier-payables', id, search],
    queryFn: () => api.get<PayableDto[]>(`/finance/cashier-sessions/${id}/payables`, { search: search || undefined }),
    enabled: !!s && s.status === 'OPEN' && mine,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['cashier-session', id] });
    void qc.invalidateQueries({ queryKey: ['cashier-payables', id] });
    void qc.invalidateQueries({ queryKey: ['cashier-sessions'] });
  };

  // One key per order click: a double tap or network retry replays instead of charging twice.
  const collect = useMutation({
    mutationFn: (orderId: string) =>
      api.post<Collected>(`/finance/cashier-sessions/${id}/collect`, { orderId }, { headers: { 'Idempotency-Key': newIdempotencyKey() } }),
    onSuccess: (p) => {
      setCollected(p);
      refresh();
    },
    onError: msg.error,
  });
  const close = useMutation({
    mutationFn: () => api.post(`/finance/cashier-sessions/${id}/close`, { countedAmount: counted, note: note || undefined }),
    onSuccess: () => { msg.success('ปิดกะแล้ว'); setClosing(false); refresh(); },
    onError: msg.error,
  });
  const remit = useMutation({
    mutationFn: () => api.post(`/finance/cashier-sessions/${id}/remit`, { remittanceNo }),
    onSuccess: () => { msg.success('บันทึกการนำส่งเงินแล้ว'); setRemitting(false); refresh(); },
    onError: msg.error,
  });
  const confirm = useMutation({
    mutationFn: () => api.post(`/finance/cashier-sessions/${id}/confirm`),
    onSuccess: () => { msg.success('ยืนยันยอดแล้ว รายการพร้อมเข้าชุดนำส่ง'); refresh(); },
    onError: msg.error,
  });
  const voidPayment = useMutation({
    mutationFn: () => api.post(`/finance/cashier-sessions/payments/${voiding!.id}/void`, { reason: voidReason }),
    onSuccess: () => { msg.success('ยกเลิกรายการแล้ว'); setVoiding(null); setVoidReason(''); refresh(); },
    onError: msg.error,
  });

  if (q.isPending) return <Card><Skeleton active /></Card>;
  if (q.isError || !s) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const diff = counted && /^\d+(\.\d{1,2})?$/.test(counted) ? (Number(counted) - Number(s.collectedAmount)).toFixed(2) : null;

  return (
    <>
      <PageHeader
        title={`กะรับเงิน ${s.sessionNo}`}
        description={`${s.eventCode} ${s.eventTitle} · ผู้รับเงิน ${s.cashierName}`}
        breadcrumb={[{ title: 'การเงิน / กองคลัง' }, { title: 'รับชำระหน้างาน', href: '/admin/finance/cashier' }, { title: s.sessionNo }]}
        actions={
          <Space wrap>
            {s.status === 'OPEN' && mine && (
              <Button icon={<LockOutlined />} onClick={() => { setCounted(''); setNote(''); setClosing(true); }}>
                ปิดกะ / นับเงิน
              </Button>
            )}
            {s.status === 'CLOSED' && (mine || can('cashier:approve')) && (
              <Button icon={<SendOutlined />} onClick={() => setRemitting(true)}>
                บันทึกการนำส่งเงิน
              </Button>
            )}
            {s.status === 'REMITTED' && can('cashier:approve') && !mine && (
              <Popconfirm title="ยืนยันว่าได้รับเงินนำส่งครบตามยอด?" okText="ยืนยันยอด" cancelText="ยกเลิก" onConfirm={() => confirm.mutate()}>
                <Button type="primary" icon={<CheckCircleOutlined />} loading={confirm.isPending}>ยืนยันยอด</Button>
              </Popconfirm>
            )}
          </Space>
        }
      />
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}><Card><Statistic title="สถานะ" valueRender={() => <StatusTag status={s.status} kind="cashier" />} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="รับเงินแล้ว (บาท)" value={s.collectedAmount} precision={2} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="จำนวนรายการ" value={s.paymentCount} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="เงินทอนตั้งต้น (บาท)" value={s.openingFloat} precision={2} /></Card></Col>
      </Row>
      {s.status !== 'OPEN' && (
        <Card style={{ marginTop: 16 }}>
          <Descriptions column={{ xs: 1, md: 2 }} size="small" bordered>
            <Descriptions.Item label="ยอดในระบบ"><Money value={s.expectedAmount} /></Descriptions.Item>
            <Descriptions.Item label="นับได้"><Money value={s.countedAmount} /></Descriptions.Item>
            <Descriptions.Item label="ส่วนต่าง">{s.difference && s.difference !== '0.00' ? <Typography.Text type="danger"><Money value={s.difference} /></Typography.Text> : 'ตรงยอด'}</Descriptions.Item>
            <Descriptions.Item label="หมายเหตุ">{s.closeNote ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="เลขที่ใบนำส่งเงิน">{s.remittanceNo ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="ยืนยันยอดโดย">{s.confirmedByName ? <>{s.confirmedByName} · <ThaiDate value={s.confirmedAt} time /></> : '-'}</Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      {s.status === 'OPEN' && mine && (
        <Card title="รับชำระ" style={{ marginTop: 16 }}>
          <Input.Search
            allowClear
            enterButton={<SearchOutlined />}
            placeholder="ค้นหาเลขอ้างอิง REG- / ใบแจ้งชำระ INV- / ชื่อ / อีเมล"
            onSearch={(v) => setSearch(v.trim())}
            style={{ maxWidth: 520, marginBottom: 12 }}
          />
          <List<PayableDto>
            loading={payables.isFetching}
            dataSource={payables.data}
            locale={{ emptyText: <Empty description="ไม่พบรายการที่รอชำระ" /> }}
            renderItem={(p) => (
              <List.Item
                actions={[
                  <Popconfirm
                    key="c"
                    title={`รับเงินสด ${p.amount} บาท?`}
                    description={`${p.payerName} · ${p.feeName}`}
                    okText="รับเงินแล้ว"
                    cancelText="ยกเลิก"
                    onConfirm={() => collect.mutate(p.orderId)}
                  >
                    <Button type="primary" loading={collect.isPending && collect.variables === p.orderId}>รับเงิน</Button>
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={<>{p.payerName} <Typography.Text type="secondary">({p.referenceNo})</Typography.Text></>}
                  description={<>{p.feeName} · <Money value={p.amount} /> · {p.payerEmail}</>}
                />
              </List.Item>
            )}
          />
        </Card>
      )}

      <Card title="รายการรับเงินในกะนี้" style={{ marginTop: 16 }}>
        <Table<CashPaymentDto>
          rowKey="id"
          dataSource={s.payments}
          pagination={false}
          scroll={{ x: 800 }}
          columns={[
            { title: 'เลขที่รายการ', dataIndex: 'paymentNo', width: 150 },
            { title: 'ผู้ชำระ', render: (_, p) => <>{p.payerName}<div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{p.referenceNo}</Typography.Text></div></> },
            { title: 'จำนวนเงิน', dataIndex: 'amount', align: 'right', width: 130, render: (v: string) => <Money value={v} /> },
            { title: 'เวลา', dataIndex: 'submittedAt', width: 160, render: (v: string) => <ThaiDate value={v} time /> },
            { title: 'สถานะ', width: 200, render: (_, p) => <><StatusTag status={p.status} kind="payment" />{p.voidReason && <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{p.voidReason}</Typography.Text></div>}</> },
            {
              title: '',
              width: 110,
              render: (_, p) =>
                s.status === 'OPEN' && p.status === 'VERIFIED' && can('cashier:void') && !mine ? (
                  <Button size="small" danger onClick={() => setVoiding(p)}>ยกเลิกรายการ</Button>
                ) : null,
            },
          ]}
        />
      </Card>

      <Modal
        open={!!collected}
        title="รับชำระเรียบร้อย"
        onCancel={() => setCollected(null)}
        footer={[
          <Button key="p" icon={<PrinterOutlined />} onClick={() => window.print()}>พิมพ์หลักฐาน</Button>,
          <Button key="ok" type="primary" onClick={() => setCollected(null)}>ปิด</Button>,
        ]}
      >
        {collected && <ProofOfPayment p={collected} session={s} />}
      </Modal>

      <Modal
        open={closing}
        title="ปิดกะและนับเงิน"
        okText="ปิดกะ"
        cancelText="ยกเลิก"
        onCancel={() => setClosing(false)}
        onOk={() => close.mutate()}
        okButtonProps={{ disabled: !/^\d+(\.\d{1,2})?$/.test(counted) || (diff !== '0.00' && note.trim().length < 3), loading: close.isPending }}
      >
        <Alert type="info" showIcon style={{ marginBottom: 12 }} title={<>ยอดในระบบ <Money value={s.collectedAmount} /> ({s.paymentCount} รายการ)</>} description="นับเฉพาะเงินที่รับจากผู้ชำระ ไม่รวมเงินทอนตั้งต้น — หลังปิดกะแล้วจะรับเงินหรือยกเลิกรายการในกะนี้ไม่ได้" />
        <Form layout="vertical">
          <Form.Item label="จำนวนเงินที่นับได้ (บาท)" required>
            <Input inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} style={{ textAlign: 'right', maxWidth: 200 }} />
          </Form.Item>
          {diff && diff !== '0.00' && <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={`ส่วนต่าง ${diff} บาท — กรุณาระบุหมายเหตุ`} />}
          <Form.Item label="หมายเหตุ">
            <Input.TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={remitting} title="บันทึกการนำส่งเงินสด" okText="บันทึก" cancelText="ยกเลิก" onCancel={() => setRemitting(false)} onOk={() => remit.mutate()} okButtonProps={{ disabled: !remittanceNo.trim(), loading: remit.isPending }}>
        <Form layout="vertical">
          <Form.Item label="เลขที่ใบนำส่งเงิน" required>
            <Input value={remittanceNo} onChange={(e) => setRemittanceNo(e.target.value)} maxLength={50} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={!!voiding} title={`ยกเลิกรายการ ${voiding?.paymentNo ?? ''}`} okText="ยกเลิกรายการ" cancelText="ปิด" onCancel={() => setVoiding(null)} onOk={() => voidPayment.mutate()} okButtonProps={{ danger: true, disabled: voidReason.trim().length < 3, loading: voidPayment.isPending }}>
        <Typography.Paragraph>ผู้ลงทะเบียนจะกลับเป็นสถานะรอชำระเงิน และมีเวลาชำระใหม่อย่างน้อย 24 ชั่วโมง</Typography.Paragraph>
        <Input.TextArea rows={3} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="เหตุผล" maxLength={1000} showCount />
      </Modal>
    </>
  );
}
