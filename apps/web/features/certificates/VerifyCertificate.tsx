'use client';

import { CheckCircleFilled, CloseCircleFilled, QuestionCircleFilled, SearchOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Descriptions, Form, Input, Result, Skeleton } from 'antd';
import { useRouter } from 'next/navigation';
import { ThaiDate, ThaiDateRange } from '@/components/Format';
import { ErrorState } from '@/components/QueryState';
import { api } from '@/services/api';
import type { VerifyResult } from './types';

/** Public certificate verification (the QR on every certificate opens /verify/<code>). */
export function VerifyCertificate({ code }: { code?: string }) {
  const router = useRouter();
  const [form] = Form.useForm<{ code: string }>();
  const check = useQuery({
    queryKey: ['verify-certificate', code],
    queryFn: () => api.get<VerifyResult>(`/public/certificates/verify/${encodeURIComponent(code!)}`),
    enabled: !!code,
    retry: false,
  });
  const r = check.data;

  return (
    <div className="page-container" style={{ paddingTop: 24, maxWidth: 760 }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>ตรวจสอบเกียรติบัตร</h1>
      <p style={{ color: '#6b7280', marginTop: 0 }}>กรอกรหัสตรวจสอบ 12 หลักที่พิมพ์บนเกียรติบัตร หรือสแกน QR บนเกียรติบัตร</p>
      <Card style={{ marginBottom: 16 }}>
        <Form form={form} layout="inline" initialValues={{ code }} onFinish={(v) => router.push(`/verify/${encodeURIComponent(v.code.trim().toUpperCase())}`)} style={{ rowGap: 8 }}>
          <Form.Item name="code" rules={[{ required: true, message: 'กรุณากรอกรหัสตรวจสอบ' }]} style={{ flex: '1 1 240px' }}>
            <Input size="large" placeholder="เช่น AB12-CD34-EF56" maxLength={20} autoComplete="off" style={{ textTransform: 'uppercase', letterSpacing: 1 }} />
          </Form.Item>
          <Form.Item>
            <Button size="large" type="primary" htmlType="submit" icon={<SearchOutlined />}>
              ตรวจสอบ
            </Button>
          </Form.Item>
        </Form>
      </Card>
      {code &&
        (check.isPending ? (
          <Card>
            <Skeleton active />
          </Card>
        ) : check.isError ? (
          <ErrorState error={check.error} onRetry={() => check.refetch()} />
        ) : r?.result === 'NOT_FOUND' ? (
          <Card>
            <Result icon={<QuestionCircleFilled style={{ color: '#9ca3af' }} />} title="ไม่พบเกียรติบัตรตามรหัสนี้" subTitle="กรุณาตรวจสอบรหัสอีกครั้ง (ตัวอักษร O กับเลข 0 และ I กับเลข 1 ระบบถือว่าเหมือนกัน)" />
          </Card>
        ) : (
          r && (
            <Card>
              <Result
                style={{ paddingBottom: 8 }}
                icon={r.result === 'VALID' ? <CheckCircleFilled style={{ color: '#16a34a' }} /> : <CloseCircleFilled style={{ color: '#dc2626' }} />}
                title={r.result === 'VALID' ? 'เกียรติบัตรนี้ออกโดยระบบจริงและยังมีผล' : 'เกียรติบัตรนี้ถูกยกเลิกแล้ว'}
                subTitle={r.result === 'REVOKED' && r.revokedAt ? <>ยกเลิกเมื่อ <ThaiDate value={r.revokedAt} /></> : undefined}
              />
              <Descriptions column={1} bordered size="middle">
                <Descriptions.Item label="ผู้ได้รับ">{r.recipientName}</Descriptions.Item>
                <Descriptions.Item label="เกียรติบัตร">{r.title}</Descriptions.Item>
                <Descriptions.Item label="กิจกรรม">{r.event?.titleTh}</Descriptions.Item>
                <Descriptions.Item label="วันที่จัด">{r.event && <ThaiDateRange start={r.event.startAt} end={r.event.endAt} />}</Descriptions.Item>
                <Descriptions.Item label="หน่วยงานผู้จัด">{r.event?.organizationName}</Descriptions.Item>
                <Descriptions.Item label="เลขที่">{r.certificateNo}</Descriptions.Item>
                <Descriptions.Item label="วันที่ออก">
                  <ThaiDate value={r.issuedAt} />
                </Descriptions.Item>
              </Descriptions>
            </Card>
          )
        ))}
    </div>
  );
}
