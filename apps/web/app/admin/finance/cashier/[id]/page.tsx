'use client';

import { CheckCircleOutlined, DisconnectOutlined, FilePdfOutlined, LockOutlined, PrinterOutlined, SearchOutlined, SendOutlined, SyncOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { newIdempotencyKey } from '@sru/api-client';
import { bahtText } from '@sru/shared-utils';
import { Alert, Button, Card, Col, Descriptions, Empty, Form, Input, Modal, Popconfirm, Row, Skeleton, Space, Statistic, Table, Tag, Typography } from 'antd';
import { List } from '@/components/SimpleList';
import { use, useEffect, useState } from 'react';
import { isNetworkError, type OfflinePayable, useOfflineCash } from '@/features/finance/offline-cash';
import { downloadFile } from '@/services/download';
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
  /** Recorded while offline: not yet on the server. */
  offline?: boolean;
}
type PayableItem = OfflinePayable & { payerEmail?: string };

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
        <Descriptions.Item label="เลขที่รายการ">{p.offline ? 'บันทึกขณะออฟไลน์ — เลขที่รายการจะออกเมื่อส่งข้อมูลเข้าระบบ' : p.paymentNo}</Descriptions.Item>
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
  const collecting = !!s && s.status === 'OPEN' && mine;
  const offline = useOfflineCash(id, collecting);
  const payables = useQuery({
    queryKey: ['cashier-payables', id, search],
    queryFn: () => api.get<PayableDto[]>(`/finance/cashier-sessions/${id}/payables`, { search: search || undefined }),
    enabled: collecting && offline.online,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['cashier-session', id] });
    void qc.invalidateQueries({ queryKey: ['cashier-payables', id] });
    void qc.invalidateQueries({ queryKey: ['cashier-sessions'] });
  };
  const pending = offline.queue.filter((i) => i.state === 'pending').length;
  const failed = offline.queue.filter((i) => i.state === 'failed');

  const sync = useMutation({
    mutationFn: () => offline.sync(),
    onSuccess: (r) => {
      if (r.synced) msg.success(`ส่งข้อมูลรายการออฟไลน์แล้ว ${r.synced} รายการ`);
      if (r.failed) msg.error(new Error(`มี ${r.failed} รายการที่ระบบไม่รับ — ส่งเรื่องให้การเงินดำเนินการ`));
      refresh();
    },
    onError: msg.error,
  });
  // Network back → replay the queue automatically.
  useEffect(() => {
    if (collecting && offline.online && pending && !offline.syncing) sync.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collecting, offline.online, pending]);
  // The local copy holds personal data: drop it once the session is closed and nothing is queued.
  useEffect(() => {
    if (s && s.status !== 'OPEN' && !offline.queue.length) offline.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.status, offline.queue.length]);

  const offlineProof = (p: PayableItem, capturedAt: string): Collected => ({
    paymentNo: '',
    amount: p.amount,
    amountText: bahtText(p.amount),
    orderNo: p.orderNo,
    payerName: p.payerName,
    referenceNo: p.referenceNo,
    submittedAt: capturedAt,
    offline: true,
  });

  // One key per order click: a double tap or network retry replays instead of charging twice.
  // Without network the collection is queued with that same key (FIN-12) and synced later.
  const collect = useMutation({
    mutationFn: async (p: PayableItem) => {
      const key = newIdempotencyKey();
      if (!navigator.onLine) return offlineProof(p, offline.enqueue(p, key).capturedAt);
      try {
        return await api.post<Collected>(`/finance/cashier-sessions/${id}/collect`, { orderId: p.orderId }, { headers: { 'Idempotency-Key': key } });
      } catch (e) {
        // The request may or may not have reached the server: queue it with the same key.
        if (isNetworkError(e)) return offlineProof(p, offline.enqueue(p, key).capturedAt);
        throw e;
      }
    },
    onSuccess: (p) => {
      setCollected(p);
      if (!p.offline) refresh();
    },
    onError: msg.error,
  });
  const list: PayableItem[] | undefined = offline.online ? payables.data : offline.localPayables(search);
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
              <Button icon={<PrinterOutlined />} disabled={!offline.online} onClick={() => downloadFile(`/finance/cashier-sessions/${id}/offline-sheet`, `${s.sessionNo}-offline.pdf`).catch(msg.error)}>
                รายชื่อสำรอง (กระดาษ)
              </Button>
            )}
            {s.status === 'OPEN' && mine && (
              <Button icon={<LockOutlined />} disabled={!!offline.queue.length} title={offline.queue.length ? 'ส่งข้อมูลรายการออฟไลน์ให้ครบก่อนปิดกะ' : undefined} onClick={() => { setCounted(''); setNote(''); setClosing(true); }}>
                ปิดกะ / นับเงิน
              </Button>
            )}
            {s.status !== 'OPEN' && (
              <Button icon={<FilePdfOutlined />} onClick={() => downloadFile(`/finance/cashier-sessions/${id}/remittance-document`, `${s.sessionNo}.pdf`, { format: 'pdf' }).catch(msg.error)}>
                ใบนำส่งเงิน (PDF)
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

      {mine && (!offline.online || offline.queue.length > 0) && (
        <Alert
          style={{ marginTop: 16 }}
          type={offline.online ? (failed.length ? 'error' : 'warning') : 'warning'}
          showIcon
          icon={offline.online ? <SyncOutlined spin={offline.syncing} /> : <DisconnectOutlined />}
          title={
            offline.online
              ? `มีรายการที่บันทึกขณะออฟไลน์ ${offline.queue.length} รายการ${failed.length ? ` (ระบบไม่รับ ${failed.length})` : ''}`
              : 'ไม่มีการเชื่อมต่อเครือข่าย — โหมดออฟไลน์'
          }
          description={
            <>
              {!offline.online && (
                <div>
                  รับเงินต่อได้จากรายชื่อที่ดาวน์โหลดไว้
                  {offline.pack ? <> (ข้อมูล ณ <ThaiDate value={offline.pack.generatedAt} time />)</> : ' — ยังไม่มีรายชื่อในเครื่อง ใช้รายชื่อสำรองแบบกระดาษ'}
                  {' '}ระบบจะส่งข้อมูลให้อัตโนมัติเมื่อเชื่อมต่อได้ · รอส่ง {pending} รายการ
                </div>
              )}
              {failed.map((f) => (
                <div key={f.key} style={{ marginTop: 4 }}>
                  <Typography.Text type="danger">
                    {f.payerName} <Money value={f.amount} /> (<ThaiDate value={f.capturedAt} time />): {f.error}
                  </Typography.Text>{' '}
                  <Popconfirm title="นำออกจากรายการ?" description="ทำเมื่อการเงินดำเนินการกับเงินสดรายการนี้แล้ว (เช่น คืนเงินผู้ชำระ)" okText="นำออก" cancelText="ยกเลิก" onConfirm={() => offline.dismiss(f.key)}>
                    <Button size="small" type="link">ดำเนินการแล้ว</Button>
                  </Popconfirm>
                </div>
              ))}
            </>
          }
          action={offline.online && pending > 0 ? <Button size="small" loading={sync.isPending} onClick={() => sync.mutate()}>ส่งข้อมูลตอนนี้</Button> : undefined}
        />
      )}

      {s.status === 'OPEN' && mine && (
        <Card title={<>รับชำระ {!offline.online && <Tag color="orange">ออฟไลน์</Tag>}</>} style={{ marginTop: 16 }}>
          <Input.Search
            allowClear
            enterButton={<SearchOutlined />}
            placeholder="ค้นหาเลขอ้างอิง REG- / ใบแจ้งชำระ INV- / ชื่อ / อีเมล"
            onSearch={(v) => setSearch(v.trim())}
            style={{ maxWidth: 520, marginBottom: 12 }}
          />
          <List<PayableItem>
            loading={offline.online && payables.isFetching}
            dataSource={list}
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
                    onConfirm={() => collect.mutate(p)}
                  >
                    <Button type="primary" loading={collect.isPending && collect.variables?.orderId === p.orderId}>รับเงิน</Button>
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={<>{p.payerName} <Typography.Text type="secondary">({p.referenceNo})</Typography.Text></>}
                  description={<>{p.feeName} · <Money value={p.amount} />{p.payerEmail ? ` · ${p.payerEmail}` : ''}</>}
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
            {
              title: 'เวลา',
              width: 170,
              render: (_, p) => (
                <>
                  <ThaiDate value={p.capturedOfflineAt ?? p.submittedAt} time />
                  {p.capturedOfflineAt && <div><Tag color="orange">บันทึกออฟไลน์</Tag></div>}
                </>
              ),
            },
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
