'use client';

import { GoogleOutlined, LockOutlined, UserOutlined } from '@ant-design/icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Divider, Form, Input, Typography } from 'antd';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { ApiError } from '@sru/api-client';
import { loginSchema, type LoginInput } from '@sru/validation';
import { RhfField } from '@/components/form/RhfField';
import { API_URL, api } from '@/services/api';

const OAUTH_ERRORS: Record<string, string> = {
  DOMAIN_NOT_ALLOWED: 'อนุญาตเฉพาะบัญชีอีเมลของมหาวิทยาลัย',
  ACCOUNT_DISABLED: 'บัญชีถูกระงับการใช้งาน',
  LOGIN_FAILED: 'เข้าสู่ระบบด้วย Google ไม่สำเร็จ',
};

/** Only same-site relative paths are accepted as redirect targets (open-redirect protection). */
function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/admin';
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const providers = useQuery({ queryKey: ['providers'], queryFn: () => api.auth.providers(), staleTime: 600_000 });
  const { control, handleSubmit } = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { username: '', password: '' } });

  const login = useMutation({
    mutationFn: (v: LoginInput) => api.auth.login(v.username, v.password),
    onSuccess: async () => {
      const me = await qc.fetchQuery({ queryKey: ['me'], queryFn: () => api.auth.me(), staleTime: 0 });
      // Participants without back-office permissions go to their own registrations.
      const fallback = me.permissions.length ? '/admin' : '/my/registrations';
      const next = params.get('next');
      router.replace(next ? safeNext(next) : fallback);
    },
  });
  const oauthError = params.get('error');
  const [username, setUsername] = useState('');
  const resend = useMutation({ mutationFn: () => api.auth.resendVerification(username) });
  const notVerified = login.error instanceof ApiError && login.error.code === 'EMAIL_NOT_VERIFIED';
  const next = params.get('next');

  return (
    <Card style={{ width: '100%', maxWidth: 420 }}>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <Typography.Title level={3} style={{ marginBottom: 0 }}>
          SRU Event Hub
        </Typography.Title>
        <Typography.Text type="secondary">ระบบบริหารจัดการกิจกรรม มหาวิทยาลัยราชภัฏสุราษฎร์ธานี</Typography.Text>
      </div>
      {oauthError && <Alert type="error" showIcon title={OAUTH_ERRORS[oauthError] ?? 'เข้าสู่ระบบไม่สำเร็จ'} style={{ marginBottom: 16 }} />}
      {login.isError && (
        <Alert
          type="error"
          showIcon
          title={login.error instanceof ApiError ? login.error.message : 'เข้าสู่ระบบไม่สำเร็จ'}
          style={{ marginBottom: 16 }}
          action={
            notVerified && (
              <Button size="small" loading={resend.isPending} disabled={resend.isSuccess} onClick={() => resend.mutate()}>
                {resend.isSuccess ? 'ส่งแล้ว' : 'ส่งลิงก์ใหม่'}
              </Button>
            )
          }
        />
      )}
      {providers.data?.google && (
        <>
          <Button block size="large" icon={<GoogleOutlined />} href={`${API_URL}/auth/google`}>
            เข้าสู่ระบบด้วยบัญชีมหาวิทยาลัย (Google)
          </Button>
          <Divider plain>หรือ</Divider>
        </>
      )}
      <Form
        layout="vertical"
        onFinish={handleSubmit((v) => {
          setUsername(v.username);
          login.mutate(v);
        })}
      >
        <RhfField control={control} name="username" label="ชื่อผู้ใช้หรืออีเมล">
          {(f) => <Input {...f} value={f.value as string} prefix={<UserOutlined />} size="large" autoComplete="username" autoFocus />}
        </RhfField>
        <RhfField control={control} name="password" label="รหัสผ่าน">
          {(f) => <Input.Password {...f} value={f.value as string} prefix={<LockOutlined />} size="large" autoComplete="current-password" />}
        </RhfField>
        <Button type="primary" htmlType="submit" block size="large" loading={login.isPending}>
          เข้าสู่ระบบ
        </Button>
      </Form>
      {providers.data?.selfRegistration && (
        <Typography.Paragraph style={{ textAlign: 'center', marginTop: 16, marginBottom: 0 }}>
          บุคคลภายนอก / ผู้ประสานงานองค์กร ยังไม่มีบัญชี?{' '}
          <Link href={next ? `/register?next=${encodeURIComponent(safeNext(next))}` : '/register'}>สมัครสมาชิก</Link>
        </Typography.Paragraph>
      )}
      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <Link href="/">← กลับหน้าแรก</Link>
      </div>
    </Card>
  );
}
