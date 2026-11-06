'use client';

import { QrcodeOutlined } from '@ant-design/icons';
import { ApiError } from '@sru/api-client';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Flex, Modal, Skeleton, Typography } from 'antd';
import { QRCodeSVG } from 'qrcode.react';
import { useState, type ReactNode } from 'react';

/**
 * The attendee's check-in QR (spec §4.8). The QR is fetched only when opened and never cached to
 * disk; it is shown large with a white quiet zone so phone screens scan reliably at the desk.
 */
export function CheckinQrButton({
  queryKey,
  load,
  title,
  subtitle,
  note,
  buttonText = 'QR เช็กอิน',
  size = 'small',
  type = 'default',
}: {
  queryKey: unknown[];
  load: () => Promise<{ code: string }>;
  title: string;
  subtitle?: ReactNode;
  note?: ReactNode;
  buttonText?: string;
  size?: 'small' | 'middle' | 'large';
  type?: 'default' | 'primary';
}) {
  const [open, setOpen] = useState(false);
  const qr = useQuery({ queryKey, queryFn: load, enabled: open, staleTime: 5 * 60_000, gcTime: 5 * 60_000, retry: false });
  return (
    <>
      <Button size={size} type={type} icon={<QrcodeOutlined />} onClick={() => setOpen(true)}>
        {buttonText}
      </Button>
      <Modal open={open} onCancel={() => setOpen(false)} footer={null} title={title} width={420} destroyOnHidden>
        {qr.isPending ? (
          <Skeleton.Image active style={{ width: 300, height: 300 }} />
        ) : qr.isError ? (
          <Alert type="warning" showIcon title={qr.error instanceof ApiError ? qr.error.message : 'ไม่สามารถแสดง QR ได้'} />
        ) : (
          <Flex vertical align="center" gap={12}>
            {subtitle && <Typography.Text strong>{subtitle}</Typography.Text>}
            <div style={{ background: '#fff', padding: 16, borderRadius: 8 }}>
              <QRCodeSVG value={qr.data.code} size={280} level="M" marginSize={0} title="QR สำหรับเช็กอิน" />
            </div>
            <Typography.Text type="secondary" style={{ textAlign: 'center' }}>
              แสดง QR นี้ที่จุดลงทะเบียนหน้างาน — เพิ่มความสว่างหน้าจอเพื่อให้สแกนได้เร็วขึ้น
            </Typography.Text>
            {note}
          </Flex>
        )}
      </Modal>
    </>
  );
}
