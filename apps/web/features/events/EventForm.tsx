'use client';

import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Col, DatePicker, Flex, Form, Input, InputNumber, Row, Select, Switch, Typography } from 'antd';
import { useFieldArray, useForm } from 'react-hook-form';
import type { OrganizationDto } from '@sru/shared-types';
import { RhfField } from '@/components/form/RhfField';
import { api } from '@/services/api';
import dayjs, { DATETIME_FMT } from '@/services/dayjs';
import { eventFormSchema, OPTION_TYPES, type EventFormValues } from './event-form-schema';
import { FeeRatesEditor } from './FeeRatesEditor';

const FIELD_TYPES = [
  { value: 'TEXT', label: 'ข้อความสั้น' },
  { value: 'TEXTAREA', label: 'ข้อความยาว' },
  { value: 'NUMBER', label: 'ตัวเลข' },
  { value: 'EMAIL', label: 'อีเมล' },
  { value: 'PHONE', label: 'เบอร์โทรศัพท์' },
  { value: 'DATE', label: 'วันที่' },
  { value: 'SELECT', label: 'ตัวเลือก (เลือก 1)' },
  { value: 'RADIO', label: 'ตัวเลือกแบบปุ่ม (เลือก 1)' },
  { value: 'MULTISELECT', label: 'ตัวเลือก (หลายข้อ)' },
  { value: 'CHECKBOX', label: 'ช่องทำเครื่องหมาย (หลายข้อ)' },
];

const toRange = (v: unknown) => {
  const r = v as [string, string] | null | undefined;
  return r ? ([dayjs(r[0]), dayjs(r[1])] as [dayjs.Dayjs, dayjs.Dayjs]) : null;
};
const fromRange = (r: [dayjs.Dayjs | null, dayjs.Dayjs | null] | null) =>
  r?.[0] && r[1] ? [r[0].toISOString(), r[1].toISOString()] : null;

const flatten = (nodes: OrganizationDto[], depth = 0): { value: string; label: string }[] =>
  nodes.flatMap((n) => [{ value: n.id, label: `${'— '.repeat(depth)}${n.nameTh}` }, ...flatten(n.children ?? [], depth + 1)]);

export function EventForm({
  defaultValues,
  onSubmit,
  submitting,
  lockedAfterApproval = false,
}: {
  defaultValues?: Partial<EventFormValues>;
  onSubmit: (v: EventFormValues) => void;
  submitting?: boolean;
  /** After approval only general details may change (server enforces the same rule). */
  lockedAfterApproval?: boolean;
}) {
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.public.lookups(), staleTime: 600_000 });
  const orgs = useQuery({ queryKey: ['orgs-tree'], queryFn: () => api.get<OrganizationDto[]>('/organizations', { tree: true }), staleTime: 600_000 });

  const { control, handleSubmit, watch } = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: {
      allowGuestRegistration: false,
      allowWaitlist: true,
      allowSelfCancel: true,
      isFeatured: false,
      participantTypeIds: [],
      tags: [],
      registrationFields: [],
      feeRates: [],
      paymentWindowHours: 72,
      ...defaultValues,
    },
  });
  const fields = useFieldArray({ control, name: 'registrationFields' });
  const L = lockedAfterApproval;

  return (
    <Form layout="vertical" onFinish={handleSubmit(onSubmit)} disabled={submitting}>
      {L && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title="กิจกรรมผ่านการอนุมัติแล้ว"
          description="แก้ไขได้เฉพาะรายละเอียดทั่วไป จำนวนรับ และแท็ก หากต้องการเปลี่ยนวันเวลา ให้ใช้เมนู “เลื่อนกำหนดการ”"
        />
      )}
      <Card title="ข้อมูลหลัก">
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <RhfField control={control} name="titleTh" label="ชื่อกิจกรรม (ภาษาไทย)" required>
              {(f) => <Input {...f} value={f.value as string} maxLength={300} showCount disabled={L} />}
            </RhfField>
          </Col>
          <Col xs={24} md={12}>
            <RhfField control={control} name="titleEn" label="ชื่อกิจกรรม (ภาษาอังกฤษ)">
              {(f) => <Input {...f} value={(f.value as string) ?? ''} maxLength={300} disabled={L} />}
            </RhfField>
          </Col>
          <Col xs={24} md={8}>
            <RhfField control={control} name="organizationId" label="หน่วยงานผู้จัด" required>
              {(f) => (
                <Select {...f} value={f.value || undefined} showSearch={{ optionFilterProp: 'label' }} loading={orgs.isPending} options={flatten(orgs.data ?? [])} placeholder="เลือกหน่วยงาน" disabled={L || !!defaultValues?.organizationId} />
              )}
            </RhfField>
          </Col>
          <Col xs={12} md={8}>
            <RhfField control={control} name="eventTypeId" label="ประเภทกิจกรรม">
              {(f) => <Select {...f} value={f.value || undefined} allowClear options={lookups.data?.eventTypes.map((t) => ({ value: t.id, label: t.nameTh }))} disabled={L} />}
            </RhfField>
          </Col>
          <Col xs={12} md={8}>
            <RhfField control={control} name="categoryId" label="หมวดหมู่">
              {(f) => <Select {...f} value={f.value || undefined} allowClear options={lookups.data?.categories.map((t) => ({ value: t.id, label: t.nameTh }))} disabled={L} />}
            </RhfField>
          </Col>
          <Col xs={24}>
            <RhfField control={control} name="description" label="รายละเอียดกิจกรรม">
              {(f) => <Input.TextArea {...f} value={(f.value as string) ?? ''} rows={5} maxLength={20000} />}
            </RhfField>
          </Col>
          <Col xs={24} md={12}>
            <RhfField control={control} name="objectives" label="วัตถุประสงค์">
              {(f) => <Input.TextArea {...f} value={(f.value as string) ?? ''} rows={4} />}
            </RhfField>
          </Col>
          <Col xs={24} md={12}>
            <RhfField control={control} name="conditions" label="เงื่อนไขการเข้าร่วม">
              {(f) => <Input.TextArea {...f} value={(f.value as string) ?? ''} rows={4} />}
            </RhfField>
          </Col>
          <Col xs={24} md={12}>
            <RhfField control={control} name="targetAudience" label="กลุ่มเป้าหมาย">
              {(f) => <Input {...f} value={(f.value as string) ?? ''} />}
            </RhfField>
          </Col>
          <Col xs={24} md={12}>
            <RhfField control={control} name="tags" label="แท็ก" help="พิมพ์แล้วกด Enter">
              {(f) => <Select {...f} mode="tags" value={(f.value as string[]) ?? []} tokenSeparators={[',']} />}
            </RhfField>
          </Col>
        </Row>
      </Card>

      <Card title="วันเวลาและสถานที่" style={{ marginTop: 16 }}>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <RhfField control={control} name="eventRange" label="วันเวลาจัดกิจกรรม" required>
              {(f) => <DatePicker.RangePicker id={f.id} showTime={{ format: 'HH:mm', minuteStep: 5 }} format={DATETIME_FMT} style={{ width: '100%' }} value={toRange(f.value)} onChange={(r) => f.onChange(fromRange(r))} disabled={L} />}
            </RhfField>
          </Col>
          <Col xs={24} md={12}>
            <RhfField control={control} name="registrationRange" label="ช่วงเปิดรับสมัคร" help="ระบบเปิดรับสมัครอัตโนมัติเมื่อถึงเวลาหลังเผยแพร่">
              {(f) => <DatePicker.RangePicker id={f.id} showTime={{ format: 'HH:mm', minuteStep: 5 }} format={DATETIME_FMT} style={{ width: '100%' }} value={toRange(f.value)} onChange={(r) => f.onChange(fromRange(r))} disabled={L} />}
            </RhfField>
          </Col>
          <Col xs={24}>
            <RhfField control={control} name="venueText" label="สถานที่">
              {(f) => <Input {...f} value={(f.value as string) ?? ''} maxLength={500} disabled={L} />}
            </RhfField>
          </Col>
        </Row>
      </Card>

      <Card title="การรับสมัคร" style={{ marginTop: 16 }}>
        <Row gutter={16}>
          <Col xs={12} md={6}>
            <RhfField control={control} name="capacity" label="จำนวนรับสูงสุด" help="เว้นว่าง = ไม่จำกัด">
              {(f) => <InputNumber id={f.id} min={1} style={{ width: '100%' }} value={f.value as number} onChange={(v) => f.onChange(v ?? null)} />}
            </RhfField>
          </Col>
          <Col xs={12} md={6}>
            <RhfField control={control} name="minParticipants" label="จำนวนขั้นต่ำ">
              {(f) => <InputNumber id={f.id} min={0} style={{ width: '100%' }} value={f.value as number} onChange={(v) => f.onChange(v ?? null)} disabled={L} />}
            </RhfField>
          </Col>
          <Col xs={24} md={12}>
            <RhfField control={control} name="budget" label="งบประมาณ (บาท)">
              {(f) => <Input id={f.id} inputMode="decimal" value={(f.value as string) ?? ''} onChange={f.onChange} placeholder="0.00" style={{ textAlign: 'right' }} disabled={L} />}
            </RhfField>
          </Col>
          <Col xs={24}>
            <RhfField control={control} name="participantTypeIds" label="ประเภทผู้เข้าร่วมที่รับสมัคร" help="ไม่เลือก = รับทุกประเภท">
              {(f) => <Checkbox.Group value={(f.value as string[]) ?? []} onChange={f.onChange} options={lookups.data?.participantTypes.map((t) => ({ value: t.id, label: t.nameTh }))} disabled={L} />}
            </RhfField>
          </Col>
          {(
            [
              ['allowGuestRegistration', 'อนุญาตลงทะเบียนโดยไม่ต้องเข้าสู่ระบบ (บุคคลภายนอก)', L],
              ['allowWaitlist', 'เปิดรับรายชื่อสำรองเมื่อที่นั่งเต็ม', false],
              ['allowSelfCancel', 'ผู้สมัครยกเลิกการลงทะเบียนได้เอง', L],
              ['isFeatured', 'แสดงเป็นกิจกรรมแนะนำ', false],
            ] as const
          ).map(([name, label, dis]) => (
            <Col xs={24} md={12} key={name}>
              <RhfField control={control} name={name} valuePropName="checked">
                {(f) => (
                  <Flex gap={8} align="center">
                    <Switch id={f.id} checked={f.value as boolean} onChange={f.onChange} disabled={dis} />
                    <label htmlFor={f.id}>{label}</label>
                  </Flex>
                )}
              </RhfField>
            </Col>
          ))}
        </Row>
      </Card>

      <FeeRatesEditor control={control} participantTypes={lookups.data?.participantTypes ?? []} disabled={L} />

      <Card
        title="คำถามเพิ่มเติมในแบบลงทะเบียน"
        style={{ marginTop: 16 }}
        extra={!L && <Button icon={<PlusOutlined />} onClick={() => fields.append({ key: `q${fields.fields.length + 1}`, labelTh: '', fieldType: 'TEXT', isRequired: false })}>เพิ่มคำถาม</Button>}
      >
        {fields.fields.length === 0 && <Typography.Text type="secondary">ยังไม่มีคำถามเพิ่มเติม (ระบบเก็บชื่อ อีเมล เบอร์โทร และหน่วยงานให้อัตโนมัติ)</Typography.Text>}
        {fields.fields.map((item, i) => {
          const type = watch(`registrationFields.${i}.fieldType`);
          return (
            <Card key={item.id} size="small" type="inner" style={{ marginBottom: 12 }} extra={!L && <Button type="text" danger aria-label="ลบคำถาม" icon={<DeleteOutlined />} onClick={() => fields.remove(i)} />} title={`คำถามที่ ${i + 1}`}>
              <Row gutter={12}>
                <Col xs={24} md={10}>
                  <RhfField control={control} name={`registrationFields.${i}.labelTh`} label="คำถาม" required>
                    {(f) => <Input {...f} value={f.value as string} disabled={L} />}
                  </RhfField>
                </Col>
                <Col xs={12} md={6}>
                  <RhfField control={control} name={`registrationFields.${i}.fieldType`} label="ชนิด">
                    {(f) => <Select {...f} value={f.value} options={FIELD_TYPES} disabled={L} />}
                  </RhfField>
                </Col>
                <Col xs={12} md={4}>
                  <RhfField control={control} name={`registrationFields.${i}.key`} label="รหัสฟิลด์">
                    {(f) => <Input {...f} value={f.value as string} disabled={L} />}
                  </RhfField>
                </Col>
                <Col xs={24} md={4}>
                  <RhfField control={control} name={`registrationFields.${i}.isRequired`} label="บังคับตอบ" valuePropName="checked">
                    {(f) => <Switch id={f.id} checked={f.value as boolean} onChange={f.onChange} disabled={L} />}
                  </RhfField>
                </Col>
                {OPTION_TYPES.has(type) && (
                  <Col xs={24}>
                    <RhfField control={control} name={`registrationFields.${i}.optionsText`} label="ตัวเลือก (บรรทัดละ 1 ตัวเลือก)" required>
                      {(f) => <Input.TextArea {...f} value={(f.value as string) ?? ''} rows={3} disabled={L} />}
                    </RhfField>
                  </Col>
                )}
              </Row>
            </Card>
          );
        })}
      </Card>

      <Flex justify="flex-end" gap={8} style={{ marginTop: 16 }}>
        <Button type="primary" htmlType="submit" size="large" loading={submitting}>
          บันทึก
        </Button>
      </Flex>
    </Form>
  );
}
