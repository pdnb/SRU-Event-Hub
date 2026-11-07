'use client';

import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Col, DatePicker, Form, Input, Modal, Row, Select, Table, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { Money, ThaiDate } from '@/components/Format';
import { useApiMessage } from '@/hooks/useApiMessage';
import { api } from '@/services/api';
import dayjs, { DATETIME_FMT } from '@/services/dayjs';
import type { AdminEventDto } from './admin-event';

/** Wire shape of a FEE_CHANGE proposal next to the current rates (approvals + event page). */
export interface FeeSide {
  feeRates: { nameTh: string; amount: string; participantTypeName: string | null; validFrom: string | null; validUntil: string | null }[];
  bankAccount: string | null;
  incomeCode: string | null;
}
export interface FeeChangeView {
  reason: string | null;
  current: FeeSide;
  proposed: FeeSide;
}
export interface PendingFeeChange extends FeeChangeView {
  requestId: string;
  round: number;
  submittedAt: string;
  submittedByName: string;
  currentStep: string | null;
}

function RatesTable({ side }: { side: FeeSide }) {
  return (
    <>
      <Table
        size="small"
        rowKey={(_, i) => String(i)}
        pagination={false}
        dataSource={side.feeRates}
        locale={{ emptyText: 'ไม่มีค่าลงทะเบียน' }}
        columns={[
          { title: 'อัตรา', render: (_, r) => <>{r.nameTh}{r.participantTypeName && <Typography.Text type="secondary"> · {r.participantTypeName}</Typography.Text>}</> },
          { title: 'บาท', dataIndex: 'amount', align: 'right', width: 110, render: (v: string) => <Money value={v} /> },
          {
            title: 'ช่วงเวลา',
            width: 200,
            render: (_, r) => (r.validFrom || r.validUntil ? <>{r.validFrom ? <ThaiDate value={r.validFrom} /> : '…'} – {r.validUntil ? <ThaiDate value={r.validUntil} /> : '…'}</> : 'ตลอด'),
          },
        ]}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        บัญชีรับเงิน: {side.bankAccount ?? '-'}
        {side.incomeCode ? ` · รหัสรายได้: ${side.incomeCode}` : ''}
      </Typography.Text>
    </>
  );
}

/** Current vs. proposed fee rates, side by side. */
export function FeeComparison({ view }: { view: FeeChangeView }) {
  return (
    <>
      {view.reason && <Typography.Paragraph>เหตุผล: {view.reason}</Typography.Paragraph>}
      <Row gutter={16}>
        <Col xs={24} lg={12}>
          <Typography.Text strong>อัตราปัจจุบัน</Typography.Text>
          <RatesTable side={view.current} />
        </Col>
        <Col xs={24} lg={12}>
          <Typography.Text strong type="warning">อัตราที่ขอแก้ไข</Typography.Text>
          <RatesTable side={view.proposed} />
        </Col>
      </Row>
    </>
  );
}

interface FinanceOptions {
  bankAccounts: { id: string; label: string }[];
  incomeCodes: { id: string; label: string }[];
}
type RateRow = { nameTh: string; amount: string; participantTypeId: string; range?: [Dayjs | null, Dayjs | null] | null };

/**
 * ขอแก้ไขอัตราค่าลงทะเบียนหลังอนุมัติ (FEE_CHANGE): goes through the approval workflow again; the
 * current rates stay in force until the request is finally approved.
 */
export function FeeChangeDialog({ event, open, onClose, onDone }: { event: AdminEventDto; open: boolean; onClose: () => void; onDone: () => void }) {
  const msg = useApiMessage();
  const [form] = Form.useForm();
  const options = useQuery({ queryKey: ['finance-options'], queryFn: () => api.get<FinanceOptions>('/finance/options'), staleTime: 600_000, enabled: open });
  const submit = useMutation({
    mutationFn: (v: { rates: RateRow[]; bankAccountId?: string; incomeCodeId?: string; reason: string }) =>
      api.post(`/events/${event.id}/fee-change`, {
        reason: v.reason,
        bankAccountId: v.bankAccountId ?? null,
        incomeCodeId: v.incomeCodeId ?? null,
        feeRates: v.rates.map((r) => ({
          nameTh: r.nameTh,
          amount: String(r.amount).trim(),
          participantTypeId: r.participantTypeId || null,
          validFrom: r.range?.[0]?.toISOString() ?? null,
          validUntil: r.range?.[1]?.toISOString() ?? null,
        })),
      }),
    onSuccess: () => {
      msg.success('ส่งคำขอแก้ไขอัตราแล้ว — อัตราเดิมยังใช้อยู่จนกว่าจะได้รับอนุมัติ');
      onDone();
      onClose();
    },
    onError: msg.error,
  });

  return (
    <Modal open={open} width={900} title="ขอแก้ไขอัตราค่าลงทะเบียน" okText="ส่งขออนุมัติ" cancelText="ยกเลิก" onCancel={onClose} onOk={() => form.submit()} confirmLoading={submit.isPending} destroyOnHidden>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title="กิจกรรมได้รับอนุมัติแล้ว การแก้ไขอัตรา/บัญชีรับเงินต้องผ่านการอนุมัติใหม่"
        description="ระหว่างรอพิจารณา ผู้ลงทะเบียนยังชำระตามอัตราเดิม และใบแจ้งชำระที่ออกไปแล้วไม่เปลี่ยนแปลง"
      />
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        onFinish={(v) => submit.mutate(v)}
        initialValues={{
          bankAccountId: event.bankAccountId ?? undefined,
          incomeCodeId: event.incomeCodeId ?? undefined,
          rates: event.feeRates.map((r) => ({
            nameTh: r.nameTh,
            amount: r.amount,
            participantTypeId: r.participantTypeId ?? '',
            range: r.validFrom || r.validUntil ? [r.validFrom ? dayjs(r.validFrom) : null, r.validUntil ? dayjs(r.validUntil) : null] : null,
          })),
        }}
      >
        <Form.List name="rates">
          {(fields, { add, remove }) => (
            <>
              {fields.map((f) => (
                <Row gutter={8} key={f.key} align="top">
                  <Col xs={24} md={6}>
                    <Form.Item name={[f.name, 'nameTh']} label="ชื่ออัตรา" rules={[{ required: true, message: 'ระบุชื่อ' }]}>
                      <Input maxLength={200} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={4}>
                    <Form.Item name={[f.name, 'amount']} label="บาท" rules={[{ required: true, pattern: /^\d{1,10}(\.\d{1,2})?$/, message: 'จำนวนเงินไม่ถูกต้อง' }]}>
                      <Input inputMode="decimal" style={{ textAlign: 'right' }} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={5}>
                    <Form.Item name={[f.name, 'participantTypeId']} label="ประเภทผู้เข้าร่วม">
                      <Select options={[{ value: '', label: 'ทุกประเภท' }, ...event.participantTypes.map((t) => ({ value: t.id, label: t.nameTh }))]} />
                    </Form.Item>
                  </Col>
                  <Col xs={20} md={8}>
                    <Form.Item name={[f.name, 'range']} label="ช่วงเวลาที่ใช้ (ว่าง = ตลอด)">
                      <DatePicker.RangePicker showTime={{ format: 'HH:mm' }} format={DATETIME_FMT} allowEmpty={[true, true]} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col xs={4} md={1}>
                    <Button type="text" danger icon={<DeleteOutlined />} style={{ marginTop: 30 }} onClick={() => remove(f.name)} aria-label="ลบอัตรา" />
                  </Col>
                </Row>
              ))}
              <Button icon={<PlusOutlined />} onClick={() => add({ nameTh: '', amount: '', participantTypeId: '' })} style={{ marginBottom: 16 }}>
                เพิ่มอัตรา
              </Button>
            </>
          )}
        </Form.List>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="bankAccountId" label="บัญชีรับเงิน">
              <Select allowClear loading={options.isPending} options={options.data?.bankAccounts.map((b) => ({ value: b.id, label: b.label }))} />
            </Form.Item>
          </Col>
          {!!options.data?.incomeCodes.length && (
            <Col xs={24} md={12}>
              <Form.Item name="incomeCodeId" label="รหัสรายได้">
                <Select allowClear options={options.data.incomeCodes.map((c) => ({ value: c.id, label: c.label }))} />
              </Form.Item>
            </Col>
          )}
        </Row>
        <Form.Item name="reason" label="เหตุผลที่ขอแก้ไข" rules={[{ required: true, min: 3, message: 'กรุณาระบุเหตุผล' }]}>
          <Input.TextArea rows={3} maxLength={1000} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}
