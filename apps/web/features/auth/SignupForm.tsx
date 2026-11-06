'use client';

import { LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Result, Typography } from 'antd';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ApiError } from '@sru/api-client';
import { api } from '@/services/api';

type Values = { displayName: string; email: string; phone?: string; password: string; confirm: string };

/** External users (e.g. group coordinators) create an account; it works after the e-mail link is opened. */
export function SignupForm() {
  const params = useSearchParams();
  const next = params.get('next');
  const providers = useQuery({ queryKey: ['providers'], queryFn: () => api.auth.providers(), staleTime: 600_000 });
  const signup = useMutation({ mutationFn: (v: Values) => api.auth.register({ displayName: v.displayName.trim(), email: v.email.trim(), phone: v.phone || undefined, password: v.password }) });
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login';

  if (signup.isSuccess) {
    return (
      <Card style={{ width: '100%', maxWidth: 480 }}>
        <Result
          status="success"
          title="กรุณายืนยันอีเมล"
          subTitle={signup.data.message}
          extra={
            <Link href={loginHref}>
              <Button type="primary">ไปหน้าเข้าสู่ระบบ</Button>
            </Link>
          }
        />
      </Card>
    );
  }

  return (
    <Card style={{ width: '100%', maxWidth: 480 }}>
      <Typography.Title level={3} style={{ marginBottom: 0, textAlign: 'center' }}>
        สมัครสมาชิก
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ textAlign: 'center' }}>
        สำหรับบุคคลภายนอกและผู้ประสานงานองค์กร — บุคลากร/นักศึกษาของมหาวิทยาลัยใช้บัญชี Google ของมหาวิทยาลัย
      </Typography.Paragraph>
      {providers.data && !providers.data.selfRegistration && <Alert type="warning" showIcon style={{ marginBottom: 16 }} title="ระบบยังไม่เปิดให้สมัครสมาชิกด้วยตนเอง กรุณาติดต่อผู้ดูแลระบบ" />}
      {signup.isError && <Alert type="error" showIcon style={{ marginBottom: 16 }} title={signup.error instanceof ApiError ? signup.error.message : 'สมัครสมาชิกไม่สำเร็จ'} />}
      <Form<Values> layout="vertical" onFinish={(v) => signup.mutate(v)} disabled={providers.data?.selfRegistration === false} requiredMark={false}>
        <Form.Item name="displayName" label="ชื่อ-นามสกุล" rules={[{ required: true, min: 2, message: 'กรุณากรอกชื่อ-นามสกุล' }]}>
          <Input prefix={<UserOutlined />} maxLength={300} autoComplete="name" />
        </Form.Item>
        <Form.Item name="email" label="อีเมล" rules={[{ required: true, type: 'email', message: 'กรุณากรอกอีเมลที่ถูกต้อง' }]}>
          <Input prefix={<MailOutlined />} maxLength={254} autoComplete="email" />
        </Form.Item>
        <Form.Item name="phone" label="เบอร์โทรศัพท์ (ไม่บังคับ)" rules={[{ pattern: /^0\d{8,9}$/, message: 'เบอร์โทรศัพท์ไม่ถูกต้อง' }]}>
          <Input inputMode="tel" maxLength={10} autoComplete="tel" />
        </Form.Item>
        <Form.Item name="password" label="รหัสผ่าน" rules={[{ required: true, min: 10, message: 'อย่างน้อย 10 ตัวอักษร' }]} hasFeedback>
          <Input.Password prefix={<LockOutlined />} maxLength={200} autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="ยืนยันรหัสผ่าน"
          dependencies={['password']}
          hasFeedback
          rules={[{ required: true, message: 'กรุณายืนยันรหัสผ่าน' }, ({ getFieldValue }) => ({ validator: (_, v) => (!v || v === getFieldValue('password') ? Promise.resolve() : Promise.reject(new Error('รหัสผ่านไม่ตรงกัน'))) })]}
        >
          <Input.Password prefix={<LockOutlined />} maxLength={200} autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block size="large" loading={signup.isPending}>
          สมัครสมาชิก
        </Button>
      </Form>
      <Typography.Paragraph style={{ textAlign: 'center', marginTop: 16, marginBottom: 0 }}>
        มีบัญชีแล้ว? <Link href={loginHref}>เข้าสู่ระบบ</Link>
      </Typography.Paragraph>
    </Card>
  );
}
