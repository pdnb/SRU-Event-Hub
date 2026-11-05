'use client';

import { Button, Result } from 'antd';
import Link from 'next/link';

export default function NotFound() {
  return (
    <Result
      status="404"
      title="ไม่พบหน้าที่ต้องการ"
      subTitle="หน้านี้อาจถูกย้ายหรือไม่มีอยู่"
      extra={
        <Link href="/">
          <Button type="primary">กลับหน้าแรก</Button>
        </Link>
      }
    />
  );
}
