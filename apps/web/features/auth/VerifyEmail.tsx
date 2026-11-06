'use client';

import { useMutation } from '@tanstack/react-query';
import { Button, Card, Result, Spin } from 'antd';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiError } from '@sru/api-client';
import { api } from '@/services/api';

/** Opens the e-mailed link: the token is in the URL fragment (#token=…) and is posted, never put in a URL. */
export function VerifyEmail() {
  const [missing, setMissing] = useState(false);
  const verify = useMutation({ mutationFn: (t: string) => api.auth.verifyEmail(t) });
  useEffect(() => {
    const t = new URLSearchParams(window.location.hash.slice(1)).get('token');
    // The fragment exists only in the browser, so it can only be read after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!t) setMissing(true);
    else verify.mutate(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card style={{ width: '100%', maxWidth: 480 }}>
      {verify.isSuccess ? (
        <Result
          status="success"
          title="ยืนยันอีเมลเรียบร้อย"
          subTitle={`บัญชี ${verify.data.email} พร้อมใช้งานแล้ว`}
          extra={
            <Link href="/login">
              <Button type="primary">เข้าสู่ระบบ</Button>
            </Link>
          }
        />
      ) : verify.isError || missing ? (
        <Result
          status="warning"
          title={verify.error instanceof ApiError ? verify.error.message : 'ลิงก์ไม่สมบูรณ์'}
          subTitle="ขอลิงก์ใหม่ได้จากหน้าเข้าสู่ระบบ (ปุ่ม “ส่งลิงก์ใหม่” หลังกรอกอีเมลและรหัสผ่าน)"
          extra={
            <Link href="/login">
              <Button>ไปหน้าเข้าสู่ระบบ</Button>
            </Link>
          }
        />
      ) : (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin /> <div style={{ marginTop: 12 }}>กำลังยืนยันอีเมล…</div>
        </div>
      )}
    </Card>
  );
}
