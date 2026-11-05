'use client';

import { useMutation } from '@tanstack/react-query';
import { Alert, App, Button, Card, Descriptions, Form, Input, Popconfirm, Typography } from 'antd';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiError } from '@sru/api-client';
import { ThaiDateRange, ThaiDate } from '@/components/Format';
import { StatusTag } from '@/components/StatusTag';
import { api } from '@/services/api';

/** Token is read from the URL fragment (#ref=…&token=…), which browsers never send to servers. */
export function RegistrationStatusLookup() {
  const { message } = App.useApp();
  const [form] = Form.useForm<{ referenceNo: string; token: string }>();
  const lookup = useMutation({ mutationFn: (v: { referenceNo: string; token: string }) => api.public.lookup(v.referenceNo.trim().toUpperCase(), v.token.trim()) });
  const [creds, setCreds] = useState<{ referenceNo: string; token: string } | null>(null);
  const cancel = useMutation({
    mutationFn: () => api.public.cancel(creds!.referenceNo, creds!.token),
    onSuccess: () => {
      message.success('ยกเลิกการลงทะเบียนแล้ว');
      lookup.mutate(creds!);
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'ไม่สามารถยกเลิกได้'),
  });

  useEffect(() => {
    const h = new URLSearchParams(window.location.hash.slice(1));
    const referenceNo = h.get('ref');
    const token = h.get('token');
    if (referenceNo && token) {
      form.setFieldsValue({ referenceNo, token });
      setCreds({ referenceNo, token });
      lookup.mutate({ referenceNo, token });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const r = lookup.data;
  const active = r && ['PENDING_PAYMENT', 'CONFIRMED', 'WAITLISTED'].includes(r.status);

  return (
    <>
      <Card>
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => {
            setCreds(v);
            lookup.mutate(v);
          }}
        >
          <Form.Item name="referenceNo" label="เลขอ้างอิง" rules={[{ required: true, pattern: /^REG-\d{4}-\d{6}$/i, message: 'รูปแบบ REG-2570-000001' }]}>
            <Input placeholder="REG-2570-000001" autoComplete="off" />
          </Form.Item>
          <Form.Item name="token" label="รหัสตรวจสอบ" rules={[{ required: true, min: 20, message: 'กรุณากรอกรหัสตรวจสอบ' }]}>
            <Input.Password autoComplete="off" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={lookup.isPending}>
            ตรวจสอบ
          </Button>
        </Form>
      </Card>
      {lookup.isError && <Alert style={{ marginTop: 16 }} type="error" showIcon title={lookup.error instanceof ApiError ? lookup.error.message : 'ไม่พบข้อมูล'} />}
      {r && (
        <Card style={{ marginTop: 16 }} title="ผลการตรวจสอบ">
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="กิจกรรม">
              <Link href={`/events/${r.event.code}`}>{r.event.titleTh}</Link>
            </Descriptions.Item>
            <Descriptions.Item label="วันเวลา">
              <ThaiDateRange start={r.event.startAt} end={r.event.endAt} />
            </Descriptions.Item>
            <Descriptions.Item label="สถานที่">{r.event.venueText ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="ผู้ลงทะเบียน">{r.fullName}</Descriptions.Item>
            <Descriptions.Item label="เลขอ้างอิง">
              <Typography.Text copyable>{r.referenceNo}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="สถานะ">
              <StatusTag status={r.status} /> {r.waitlistPosition ? `ลำดับสำรองที่ ${r.waitlistPosition}` : null}
            </Descriptions.Item>
            <Descriptions.Item label="วันที่ลงทะเบียน">
              <ThaiDate value={r.createdAt} time />
            </Descriptions.Item>
          </Descriptions>
          {active && r.event.allowSelfCancel && (
            <Popconfirm title="ยืนยันการยกเลิกการลงทะเบียน?" description="เมื่อยกเลิกแล้ว ที่นั่งจะถูกส่งต่อให้ผู้อยู่ในรายชื่อสำรอง" okText="ยกเลิกการลงทะเบียน" cancelText="ไม่ใช่" okButtonProps={{ danger: true }} onConfirm={() => cancel.mutate()}>
              <Button danger style={{ marginTop: 16 }} loading={cancel.isPending}>
                ยกเลิกการลงทะเบียน
              </Button>
            </Popconfirm>
          )}
        </Card>
      )}
    </>
  );
}
