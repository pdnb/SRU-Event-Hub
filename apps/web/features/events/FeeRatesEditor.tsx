'use client';

import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, DatePicker, Input, InputNumber, Row, Select, Typography } from 'antd';
import { useFieldArray, type Control } from 'react-hook-form';
import { RhfField } from '@/components/form/RhfField';
import { api } from '@/services/api';
import dayjs, { DATETIME_FMT } from '@/services/dayjs';
import type { EventFormValues } from './event-form-schema';

interface FinanceOptions {
  bankAccounts: { id: string; label: string; organizationName: string; hasPromptPay: boolean }[];
  incomeCodes: { id: string; code: string; label: string }[];
}

/**
 * Fee rates (per participant type, optional early-bird window), receiving account, income code and
 * payment window. Amounts are strings end-to-end (never floats); the backend snapshots the applicable
 * rate into each payment order, and กองคลัง reviews this section in the finance approval step.
 */
export function FeeRatesEditor({
  control,
  participantTypes,
  disabled,
}: {
  control: Control<EventFormValues>;
  participantTypes: { id: string; nameTh: string }[];
  disabled?: boolean;
}) {
  const rates = useFieldArray({ control, name: 'feeRates' });
  const options = useQuery({ queryKey: ['finance-options'], queryFn: () => api.get<FinanceOptions>('/finance/options'), staleTime: 600_000 });

  return (
    <Card
      title="ค่าลงทะเบียนและการชำระเงิน"
      style={{ marginTop: 16 }}
      extra={
        !disabled && (
          <Button icon={<PlusOutlined />} onClick={() => rates.append({ nameTh: rates.fields.length ? '' : 'อัตราทั่วไป', amount: '', participantTypeId: null, validRange: null })}>
            เพิ่มอัตรา
          </Button>
        )
      }
    >
      {rates.fields.length === 0 ? (
        <Typography.Text type="secondary">ไม่มีค่าลงทะเบียน (กิจกรรมฟรี) — กด &quot;เพิ่มอัตรา&quot; หากต้องการเก็บค่าลงทะเบียน</Typography.Text>
      ) : (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            title="กติกาการเลือกอัตรา"
            description="ระบบใช้อัตราที่ระบุประเภทผู้เข้าร่วมก่อนอัตราทั่วไป และถ้ามีหลายอัตราในช่วงเวลาเดียวกันจะใช้อัตราที่ต่ำที่สุด (เช่น Early bird) — อัตรา 0 บาท = ไม่ต้องชำระ กิจกรรมที่มีค่าลงทะเบียนต้องผ่านการตรวจสอบของกองคลังในขั้นอนุมัติ"
          />
          {rates.fields.map((item, i) => (
            <Card
              key={item.id}
              size="small"
              type="inner"
              style={{ marginBottom: 12 }}
              title={`อัตราที่ ${i + 1}`}
              extra={!disabled && <Button type="text" danger aria-label="ลบอัตรา" icon={<DeleteOutlined />} onClick={() => rates.remove(i)} />}
            >
              <Row gutter={12}>
                <Col xs={24} md={8}>
                  <RhfField control={control} name={`feeRates.${i}.nameTh`} label="ชื่ออัตรา" required>
                    {(f) => <Input {...f} value={f.value as string} placeholder="เช่น อัตราทั่วไป, Early bird" disabled={disabled} />}
                  </RhfField>
                </Col>
                <Col xs={12} md={5}>
                  <RhfField control={control} name={`feeRates.${i}.amount`} label="จำนวนเงิน (บาท)" required>
                    {(f) => <Input id={f.id} inputMode="decimal" value={(f.value as string) ?? ''} onChange={f.onChange} placeholder="0.00" style={{ textAlign: 'right' }} disabled={disabled} />}
                  </RhfField>
                </Col>
                <Col xs={12} md={11}>
                  <RhfField control={control} name={`feeRates.${i}.participantTypeId`} label="ใช้กับ">
                    {(f) => (
                      <Select
                        id={f.id}
                        value={(f.value as string | null) ?? ''}
                        onChange={(v) => f.onChange(v || null)}
                        options={[{ value: '', label: 'ทุกประเภทผู้เข้าร่วม' }, ...participantTypes.map((t) => ({ value: t.id, label: t.nameTh }))]}
                        disabled={disabled}
                      />
                    )}
                  </RhfField>
                </Col>
                <Col xs={24}>
                  <RhfField control={control} name={`feeRates.${i}.validRange`} label="ช่วงเวลาที่ใช้อัตรานี้" help="เว้นว่าง = ใช้ตลอดช่วงรับสมัคร (เวลาสิ้นสุดไม่รวม)">
                    {(f) => {
                      const r = f.value as [string | null, string | null] | null | undefined;
                      return (
                        <DatePicker.RangePicker
                          id={f.id}
                          showTime={{ format: 'HH:mm' }}
                          format={DATETIME_FMT}
                          allowEmpty={[true, true]}
                          value={r ? [r[0] ? dayjs(r[0]) : null, r[1] ? dayjs(r[1]) : null] : null}
                          onChange={(v) => f.onChange(v && (v[0] || v[1]) ? [v[0]?.toISOString() ?? null, v[1]?.toISOString() ?? null] : null)}
                          style={{ width: '100%' }}
                          disabled={disabled}
                        />
                      );
                    }}
                  </RhfField>
                </Col>
              </Row>
            </Card>
          ))}
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <RhfField control={control} name="bankAccountId" label="บัญชีรับเงิน" required>
                {(f) => (
                  <Select
                    id={f.id}
                    value={(f.value as string | null) ?? undefined}
                    onChange={f.onChange}
                    loading={options.isPending}
                    placeholder="เลือกบัญชีรับเงิน"
                    options={options.data?.bankAccounts.map((b) => ({ value: b.id, label: `${b.label}${b.hasPromptPay ? ' · พร้อมเพย์' : ''}` }))}
                    disabled={disabled}
                  />
                )}
              </RhfField>
            </Col>
            <Col xs={24} md={8}>
              <RhfField control={control} name="incomeCodeId" label="รหัสรายได้">
                {(f) => (
                  <Select
                    id={f.id}
                    allowClear
                    value={(f.value as string | null) ?? undefined}
                    onChange={(v) => f.onChange(v ?? null)}
                    placeholder="เลือกรหัสรายได้"
                    options={options.data?.incomeCodes.map((c) => ({ value: c.id, label: c.label }))}
                    disabled={disabled}
                  />
                )}
              </RhfField>
            </Col>
            <Col xs={24} md={4}>
              <RhfField control={control} name="paymentWindowHours" label="ชำระภายใน (ชม.)" help="นับจากลงทะเบียน">
                {(f) => <InputNumber id={f.id} min={1} max={720} style={{ width: '100%' }} value={f.value as number} onChange={(v) => f.onChange(v ?? 72)} disabled={disabled} />}
              </RhfField>
            </Col>
          </Row>
        </>
      )}
    </Card>
  );
}
