'use client';

import { InboxOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import type { PaymentOrderDto } from '@sru/shared-types';
import { Alert, App, Button, Card, DatePicker, Descriptions, Flex, Space, Typography, Upload } from 'antd';
import type { Dayjs } from 'dayjs';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { useNowMinute } from '@/hooks/useClientValue';
import { Money, ThaiDate } from '@/components/Format';
import { StatusTag } from '@/components/StatusTag';
import { BillingEditor } from '@/features/finance/billing';
import { useApiMessage } from '@/hooks/useApiMessage';
import dayjs from '@/services/dayjs';

const MAX_MB = 5;
const ACCEPT = '.jpg,.jpeg,.png,.pdf';

function useRemaining(dueAt: string) {
  const now = useNowMinute();
  if (now === null) return null; // server render: no countdown (avoids hydration mismatch)
  const ms = new Date(dueAt).getTime() - now;
  if (ms <= 0) return 'เลยกำหนดแล้ว';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h >= 24 ? `เหลือ ${Math.floor(h / 24)} วัน ${h % 24} ชั่วโมง` : `เหลือ ${h} ชั่วโมง ${m} นาที`;
}

/**
 * Payment instructions + slip upload for one order. The amount, QR payload and bank details all
 * come from the backend snapshot – nothing is computed in the browser. Shown on the status page,
 * "my registrations" and right after registering.
 */
export function PaymentPanel({
  order,
  upload,
  saveBilling,
  onChanged,
}: {
  order: PaymentOrderDto;
  upload: (file: File, transferredAt?: string) => Promise<unknown>;
  /** FIN-9: when given, the payer can choose who the official receipt is made out to. */
  saveBilling?: (billing: object) => Promise<unknown>;
  onChanged?: () => void;
}) {
  const msg = useApiMessage();
  const { message } = App.useApp();
  const [file, setFile] = useState<File | null>(null);
  const [transferredAt, setTransferredAt] = useState<Dayjs | null>(null);
  const remaining = useRemaining(order.dueAt);
  const latest = order.latestPayment;
  const submit = useMutation({
    mutationFn: () => upload(file!, transferredAt?.toISOString()),
    onSuccess: () => {
      msg.success('ส่งหลักฐานการชำระเงินแล้ว รอเจ้าหน้าที่ตรวจสอบ');
      setFile(null);
      onChanged?.();
    },
    onError: msg.error,
  });

  const bank = order.bankAccount;
  return (
    <Card
      title={
        <Space wrap>
          <span>การชำระเงิน</span>
          <StatusTag status={order.status} />
        </Space>
      }
      extra={<Typography.Text type="secondary">ใบแจ้งชำระ {order.orderNo}</Typography.Text>}
    >
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="รายการ">{order.feeName}</Descriptions.Item>
        <Descriptions.Item label="จำนวนเงิน">
          <Typography.Text strong style={{ fontSize: 18 }}>
            <Money value={order.amount} />
          </Typography.Text>
          <div>
            <Typography.Text type="secondary">({order.amountText})</Typography.Text>
          </div>
        </Descriptions.Item>
        {order.status === 'UNPAID' && (
          <Descriptions.Item label="ชำระภายใน">
            <ThaiDate value={order.dueAt} time /> {remaining && <Typography.Text type="warning"> · {remaining}</Typography.Text>}
          </Descriptions.Item>
        )}
        {order.paidAt && (
          <Descriptions.Item label="ชำระเมื่อ">
            <ThaiDate value={order.paidAt} time />
          </Descriptions.Item>
        )}
        {order.billing && (
          <Descriptions.Item label="ออกใบเสร็จในนาม">
            <BillingEditor
              value={order.billing}
              disabled={!saveBilling || ['CANCELLED', 'EXPIRED', 'REFUNDED'].includes(order.status)}
              onSave={async (b) => {
                await saveBilling!(b);
                onChanged?.();
              }}
            />
          </Descriptions.Item>
        )}
      </Descriptions>

      {latest?.status === 'REJECTED' && order.status === 'UNPAID' && (
        <Alert style={{ marginTop: 16 }} type="error" showIcon title="หลักฐานการชำระเงินไม่ผ่านการตรวจสอบ" description={`เหตุผล: ${latest.rejectReason ?? '-'} — กรุณาแนบหลักฐานใหม่`} />
      )}
      {order.status === 'PENDING_VERIFICATION' && (
        <Alert style={{ marginTop: 16 }} type="info" showIcon title="ได้รับหลักฐานการชำระเงินแล้ว" description="เจ้าหน้าที่กำลังตรวจสอบ ที่นั่งของท่านจะถูกสงวนไว้ระหว่างการตรวจสอบ" />
      )}
      {order.status === 'PAID' && (
        <Alert
          style={{ marginTop: 16 }}
          type="success"
          showIcon
          title="ชำระเงินเรียบร้อยแล้ว"
          description="ใบเสร็จรับเงินฉบับทางราชการออกโดยกองคลัง มหาวิทยาลัยราชภัฏสุราษฎร์ธานี"
        />
      )}

      {order.status === 'UNPAID' && (
        // Wraps by available card width (the panel also lives in a narrow sidebar column).
        <Flex wrap gap={24} align="flex-start" style={{ marginTop: 16 }}>
          {order.promptPayPayload && (
            <Flex vertical align="center" gap={8} style={{ flex: '0 1 240px', margin: '0 auto' }}>
                <div style={{ background: '#fff', padding: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}>
                  <QRCodeSVG value={order.promptPayPayload} size={208} level="M" title={`พร้อมเพย์ ${order.amount} บาท`} />
                </div>
                <Typography.Text type="secondary" style={{ textAlign: 'center' }}>
                  สแกนด้วยแอปธนาคาร (Thai QR / พร้อมเพย์)
                  <br />
                  ยอดเงินถูกกำหนดไว้ในคิวอาร์แล้ว
                </Typography.Text>
            </Flex>
          )}
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            {bank && (
              <Descriptions column={1} size="small" title="หรือโอนเข้าบัญชี">
                <Descriptions.Item label="ธนาคาร">
                  {bank.bankName}
                  {bank.branch ? ` ${bank.branch}` : ''}
                </Descriptions.Item>
                <Descriptions.Item label="เลขที่บัญชี">
                  <Typography.Text copyable strong>
                    {bank.accountNo}
                  </Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="ชื่อบัญชี">{bank.accountName}</Descriptions.Item>
              </Descriptions>
            )}
            <Typography.Title level={5} style={{ marginTop: 8 }}>
              แนบหลักฐานการโอนเงิน
            </Typography.Title>
            <Upload.Dragger
              style={{ height: 'auto', padding: '8px 0' }}
              accept={ACCEPT}
              maxCount={1}
              fileList={file ? [{ uid: '1', name: file.name, status: 'done' }] : []}
              beforeUpload={(f) => {
                if (f.size > MAX_MB * 1024 * 1024) {
                  message.error(`ไฟล์มีขนาดเกิน ${MAX_MB} MB`);
                  return Upload.LIST_IGNORE;
                }
                setFile(f);
                return false; // upload on submit
              }}
              onRemove={() => setFile(null)}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">คลิกหรือลากไฟล์สลิปมาวาง</p>
              <p className="ant-upload-hint">JPG, PNG หรือ PDF ไม่เกิน {MAX_MB} MB</p>
            </Upload.Dragger>
            <Space wrap style={{ marginTop: 12 }}>
              <DatePicker
                showTime={{ format: 'HH:mm' }}
                format="D MMM BBBB HH:mm"
                placeholder="วันเวลาที่โอน"
                value={transferredAt}
                onChange={setTransferredAt}
                disabledDate={(d) => d.isAfter(dayjs())}
              />
              <Button type="primary" disabled={!file} loading={submit.isPending} onClick={() => submit.mutate()}>
                ส่งหลักฐาน
              </Button>
            </Space>
          </div>
        </Flex>
      )}
      <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0, fontSize: 13 }}>
        ระบบออก &quot;หลักฐานการชำระเงิน&quot; เท่านั้น ไม่ใช่ใบเสร็จรับเงิน
      </Typography.Paragraph>
    </Card>
  );
}
