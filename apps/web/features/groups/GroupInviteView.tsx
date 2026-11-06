'use client';

import { useMutation } from '@tanstack/react-query';
import type { GroupInvitationViewDto } from '@sru/shared-types';
import { Alert, Button, Card, Descriptions, Form, Result, Skeleton } from 'antd';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiError } from '@sru/api-client';
import { ThaiDate, ThaiDateRange } from '@/components/Format';
import { useApiMessage } from '@/hooks/useApiMessage';
import { api } from '@/services/api';
import { MemberForm, memberToValues, valuesToBody, type MemberValues } from './MemberForm';

/**
 * Invitation link page. The token lives in the URL fragment (#token=…), which browsers never send to
 * servers, and is posted in the request body only.
 */
export function GroupInviteView() {
  const msg = useApiMessage();
  const [token, setToken] = useState<string | null>(null);
  const [form] = Form.useForm<MemberValues>();
  const view = useMutation({ mutationFn: (t: string) => api.post<GroupInvitationViewDto>('/public/group-invitations/view', { token: t }) });
  const accept = useMutation({
    mutationFn: (v: MemberValues) => api.post('/public/group-invitations/accept', { ...valuesToBody(v), pdpaConsent: v.pdpaConsent === true, token }),
    onError: msg.error,
  });

  useEffect(() => {
    const t = new URLSearchParams(window.location.hash.slice(1)).get('token');
    if (t) {
      // The fragment exists only in the browser, so it can only be read after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setToken(t);
      view.mutate(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!token) return <Alert type="warning" showIcon title="ลิงก์ไม่สมบูรณ์" description="กรุณาเปิดจากลิงก์ที่ได้รับจากผู้ประสานงานกลุ่มโดยตรง" />;
  if (view.isPending) return <Skeleton active />;
  if (view.isError)
    return <Result status="warning" title={view.error instanceof ApiError ? view.error.message : 'ไม่สามารถเปิดลิงก์ได้'} subTitle="กรุณาติดต่อผู้ประสานงานกลุ่มเพื่อขอลิงก์ใหม่" />;
  const d = view.data;
  if (!d) return null;

  if (accept.isSuccess) {
    return (
      <Result
        status="success"
        title="บันทึกข้อมูลของท่านเรียบร้อยแล้ว"
        subTitle={`ผู้ประสานงาน (${d.coordinatorName}) จะเป็นผู้ส่งกลุ่มและดำเนินการชำระเงินในนาม ${d.organizationName}`}
        extra={
          <Link href={`/events/${d.event.code}`}>
            <Button>ดูรายละเอียดกิจกรรม</Button>
          </Link>
        }
      />
    );
  }

  return (
    <>
      <Card style={{ marginBottom: 16 }}>
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="กิจกรรม">
            <Link href={`/events/${d.event.code}`}>{d.event.titleTh}</Link>
          </Descriptions.Item>
          <Descriptions.Item label="วันเวลา">
            <ThaiDateRange start={d.event.startAt} end={d.event.endAt} />
          </Descriptions.Item>
          <Descriptions.Item label="สถานที่">{d.event.venueText ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="กลุ่ม">
            {d.groupName} ({d.groupNo}) — {d.organizationName}
          </Descriptions.Item>
          <Descriptions.Item label="ผู้ประสานงาน">{d.coordinatorName}</Descriptions.Item>
          <Descriptions.Item label="ลิงก์หมดอายุ">
            <ThaiDate value={d.expiresAt} time />
          </Descriptions.Item>
        </Descriptions>
      </Card>
      <Card title={d.member ? 'ตรวจสอบและกรอกข้อมูลของท่าน' : 'กรอกข้อมูลเพื่อเข้าร่วมกลุ่ม'}>
        <MemberForm
          form={form}
          fields={d.fields}
          participantTypes={d.participantTypes}
          strictRequired
          askConsent
          initialValues={d.member ? memberToValues(d.member) : undefined}
          onFinish={(v) => accept.mutate(v)}
        />
        <Button type="primary" size="large" block loading={accept.isPending} onClick={() => form.submit()}>
          ยืนยันข้อมูล
        </Button>
      </Card>
    </>
  );
}
