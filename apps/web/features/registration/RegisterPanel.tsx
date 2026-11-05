'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Col, DatePicker, Form, Input, InputNumber, Radio, Result, Row, Select, Typography } from 'antd';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ApiError, newIdempotencyKey } from '@sru/api-client';
import type { EventDetailDto, RegistrationFieldDto } from '@sru/shared-types';
import { registrationSchema } from '@sru/validation';
import { RhfField } from '@/components/form/RhfField';
import { useMe } from '@/hooks/useMe';
import { api } from '@/services/api';
import dayjs, { DATE_FMT } from '@/services/dayjs';

type Values = z.infer<typeof registrationSchema> & { answers: Record<string, unknown> };

function buildSchema(fields: RegistrationFieldDto[]) {
  const answers = z.object(
    Object.fromEntries(
      fields.map((f) => {
        const multi = f.fieldType === 'MULTISELECT' || f.fieldType === 'CHECKBOX';
        let s: z.ZodType = multi ? z.array(z.string()) : z.string().trim();
        if (f.isRequired) {
          s = multi
            ? z.array(z.string()).min(1, `กรุณาเลือก ${f.labelTh}`)
            : z.string({ error: `กรุณากรอก ${f.labelTh}` }).trim().min(1, `กรุณากรอก ${f.labelTh}`);
        } else s = s.optional();
        return [f.key, s];
      }),
    ),
  );
  return registrationSchema.extend({ answers });
}

export function RegisterPanel({ event }: { event: EventDetailDto }) {
  const me = useMe();
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.public.lookups(), staleTime: 600_000 });
  const types = event.participantTypes.length ? event.participantTypes : (lookups.data?.participantTypes ?? []);
  const schema = useMemo(() => buildSchema(event.registrationFields), [event.registrationFields]);
  // One key per form submission attempt: double-clicks and network retries are de-duplicated server-side.
  const idemKey = useRef(newIdempotencyKey());
  const [serverErrors, setServerErrors] = useState<string | null>(null);

  const { control, handleSubmit, setError } = useForm<Values>({
    resolver: zodResolver(schema) as never,
    defaultValues: { answers: {}, email: '', firstName: '', lastName: '', participantTypeCode: '' } as Partial<Values>,
  });

  const mutation = useMutation({
    mutationFn: (v: Values) =>
      api.public.register(
        event.id,
        {
          ...v,
          phone: v.phone || undefined,
          answers: Object.entries(v.answers ?? {})
            .filter(([, val]) => val !== undefined && val !== '' && !(Array.isArray(val) && !val.length))
            .map(([key, value]) => ({ key, value })),
        },
        idemKey.current,
      ),
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'VALIDATION_ERROR' && e.details && typeof e.details === 'object' && !Array.isArray(e.details)) {
        for (const [k, msg] of Object.entries(e.details as Record<string, string>)) setError(`answers.${k}` as never, { message: msg });
      }
      setServerErrors(e instanceof ApiError ? e.message : 'ไม่สามารถลงทะเบียนได้ กรุณาลองใหม่');
      // A rejected request may be retried with corrected data → new key.
      idemKey.current = newIdempotencyKey();
    },
  });

  if (mutation.isSuccess) {
    const r = mutation.data;
    const link = `/registration/status#ref=${encodeURIComponent(r.referenceNo)}&token=${encodeURIComponent(r.accessToken)}`;
    return (
      <Card>
        <Result
          status={r.status === 'WAITLISTED' ? 'info' : 'success'}
          title={r.status === 'WAITLISTED' ? 'อยู่ในรายชื่อสำรอง' : 'ลงทะเบียนสำเร็จ'}
          subTitle={
            <>
              เลขอ้างอิง <Typography.Text strong copyable>{r.referenceNo}</Typography.Text>
              {r.waitlistPosition && <div>ลำดับสำรองที่ {r.waitlistPosition}</div>}
            </>
          }
          extra={
            <Link href={link}>
              <Button type="primary">ดูสถานะการลงทะเบียน</Button>
            </Link>
          }
        />
        <Alert
          type="warning"
          showIcon
          title="กรุณาบันทึกลิงก์ตรวจสอบสถานะไว้"
          description="ลิงก์ดังกล่าวใช้ตรวจสอบหรือยกเลิกการลงทะเบียนโดยไม่ต้องเข้าสู่ระบบ และจะแสดงเพียงครั้งเดียว"
        />
      </Card>
    );
  }

  if (!event.registrationOpen) {
    return (
      <Card title="ลงทะเบียน">
        <Alert type="info" showIcon title={new Date(event.endAt) < new Date() ? 'กิจกรรมนี้จัดไปแล้ว' : 'ขณะนี้ยังไม่เปิดหรือปิดรับสมัครแล้ว'} />
      </Card>
    );
  }
  if (event.isPaid) {
    return (
      <Card title="ลงทะเบียน">
        <Alert type="info" showIcon title="กิจกรรมที่มีค่าลงทะเบียน" description="ระบบชำระเงินออนไลน์อยู่ระหว่างเปิดใช้งาน กรุณาติดต่อหน่วยงานผู้จัด" />
      </Card>
    );
  }
  if (!event.allowGuestRegistration && !me.data) {
    return (
      <Card title="ลงทะเบียน">
        <Alert type="info" showIcon title="กิจกรรมนี้ต้องเข้าสู่ระบบก่อนลงทะเบียน" style={{ marginBottom: 12 }} />
        <Link href={`/login?next=/events/${event.code}`}>
          <Button type="primary" block>
            เข้าสู่ระบบเพื่อลงทะเบียน
          </Button>
        </Link>
      </Card>
    );
  }

  const full = event.capacity != null && event.seatsTaken >= event.capacity;

  return (
    <Card title="ลงทะเบียนเข้าร่วมกิจกรรม">
      {full && <Alert type="warning" showIcon title="ที่นั่งเต็มแล้ว" description="ท่านยังลงทะเบียนได้ โดยจะอยู่ในรายชื่อสำรองตามลำดับ" style={{ marginBottom: 12 }} />}
      {serverErrors && <Alert type="error" showIcon title={serverErrors} closable={{ onClose: () => setServerErrors(null) }} style={{ marginBottom: 12 }} />}
      <Form layout="vertical" onFinish={handleSubmit((v) => mutation.mutate(v))} requiredMark>
        <RhfField control={control} name="participantTypeCode" label="ประเภทผู้เข้าร่วม" required>
          {(f) => <Select {...f} value={f.value || undefined} placeholder="เลือกประเภท" options={types.map((t) => ({ value: t.code, label: t.nameTh }))} />}
        </RhfField>
        <Row gutter={8}>
          <Col span={8}>
            <RhfField control={control} name="prefix" label="คำนำหน้า">
              {(f) => <Input {...f} value={(f.value as string) ?? ''} maxLength={50} />}
            </RhfField>
          </Col>
          <Col span={16}>
            <RhfField control={control} name="firstName" label="ชื่อ" required>
              {(f) => <Input {...f} value={(f.value as string) ?? ''} maxLength={150} autoComplete="given-name" />}
            </RhfField>
          </Col>
        </Row>
        <RhfField control={control} name="lastName" label="นามสกุล" required>
          {(f) => <Input {...f} value={(f.value as string) ?? ''} maxLength={150} autoComplete="family-name" />}
        </RhfField>
        <RhfField control={control} name="email" label="อีเมล" required>
          {(f) => <Input {...f} value={(f.value as string) ?? ''} type="email" autoComplete="email" />}
        </RhfField>
        <RhfField control={control} name="phone" label="เบอร์โทรศัพท์">
          {(f) => <Input {...f} value={(f.value as string) ?? ''} inputMode="tel" maxLength={10} autoComplete="tel" />}
        </RhfField>
        <RhfField control={control} name="studentOrStaffCode" label="รหัสนักศึกษา / รหัสบุคลากร (ถ้ามี)">
          {(f) => <Input {...f} value={(f.value as string) ?? ''} maxLength={30} />}
        </RhfField>
        <RhfField control={control} name="affiliation" label="หน่วยงาน / คณะ / สถานศึกษา">
          {(f) => <Input {...f} value={(f.value as string) ?? ''} maxLength={300} />}
        </RhfField>

        {event.registrationFields.map((field) => (
          <RhfField key={field.key} control={control} name={`answers.${field.key}` as never} label={field.labelTh} required={field.isRequired} help={field.helpText ?? undefined}>
            {(f) => <DynamicInput field={field} {...f} />}
          </RhfField>
        ))}

        <RhfField control={control} name="pdpaConsent" valuePropName="checked">
          {(f) => (
            <Checkbox checked={f.value as boolean} onChange={f.onChange} id={f.id}>
              ข้าพเจ้ายินยอมให้มหาวิทยาลัยเก็บรวบรวมและใช้ข้อมูลส่วนบุคคลข้างต้นเพื่อการจัดกิจกรรมนี้ ตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562
            </Checkbox>
          )}
        </RhfField>
        <Button type="primary" htmlType="submit" size="large" block loading={mutation.isPending}>
          {full ? 'ลงทะเบียนรายชื่อสำรอง' : 'ยืนยันการลงทะเบียน'}
        </Button>
      </Form>
    </Card>
  );
}

function DynamicInput({ field, value, onChange, onBlur, id }: { field: RegistrationFieldDto; value: unknown; onChange: (v: unknown) => void; onBlur: () => void; id: string }) {
  const options = field.options.map((o) => ({ value: o.value, label: o.labelTh }));
  switch (field.fieldType) {
    case 'TEXTAREA':
      return <Input.TextArea id={id} rows={3} value={(value as string) ?? ''} onChange={onChange} onBlur={onBlur} maxLength={field.maxLength ?? 5000} />;
    case 'NUMBER':
      return <InputNumber id={id} style={{ width: '100%' }} value={value as number} onChange={(v) => onChange(v == null ? '' : String(v))} onBlur={onBlur} />;
    case 'DATE':
      return <DatePicker id={id} style={{ width: '100%' }} format={DATE_FMT} value={value ? dayjs(value as string) : null} onChange={(d) => onChange(d ? d.format('YYYY-MM-DD') : '')} />;
    case 'SELECT':
      return <Select id={id} value={value || undefined} onChange={onChange} options={options} placeholder="เลือก" />;
    case 'MULTISELECT':
      return <Select id={id} mode="multiple" value={(value as string[]) ?? []} onChange={onChange} options={options} placeholder="เลือกได้หลายข้อ" />;
    case 'RADIO':
      return <Radio.Group id={id} value={value} onChange={(e) => onChange(e.target.value)} options={options} />;
    case 'CHECKBOX':
      return <Checkbox.Group value={(value as string[]) ?? []} onChange={onChange} options={options} />;
    default:
      return <Input id={id} value={(value as string) ?? ''} onChange={onChange} onBlur={onBlur} maxLength={field.maxLength ?? 500} type={field.fieldType === 'EMAIL' ? 'email' : 'text'} />;
  }
}
