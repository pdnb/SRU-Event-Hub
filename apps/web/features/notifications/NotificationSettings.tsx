'use client';

import { DisconnectOutlined, LinkOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Flex, Popconfirm, Skeleton, Switch, Tag, Typography } from 'antd';
import { useState } from 'react';
import { ThaiDate } from '@/components/Format';
import { ErrorState } from '@/components/QueryState';
import { useApiMessage } from '@/hooks/useApiMessage';
import { api } from '@/services/api';

interface Prefs {
  email: boolean;
  line: boolean;
  lineLinked: boolean;
  lineLinkedAt: string | null;
  lineAvailable: boolean;
  lineBotId: string | null;
  emailAvailable: boolean;
}

/** Channel choices + LINE linking (one-time code sent to the official account). */
export function NotificationSettings() {
  const qc = useQueryClient();
  const msg = useApiMessage();
  const prefs = useQuery({ queryKey: ['notification-prefs'], queryFn: () => api.get<Prefs>('/me/notification-preferences') });
  const [code, setCode] = useState<{ code: string; expiresAt: string; botId: string | null } | null>(null);
  const save = useMutation({
    mutationFn: (p: Partial<Pick<Prefs, 'email' | 'line'>>) => api.put<Prefs>('/me/notification-preferences', p),
    onSuccess: (p) => qc.setQueryData(['notification-prefs'], p),
    onError: msg.error,
  });
  const link = useMutation({ mutationFn: () => api.post<{ code: string; expiresAt: string; botId: string | null }>('/me/line/link-code'), onSuccess: setCode, onError: msg.error });
  const unlink = useMutation({
    mutationFn: () => api.del('/me/line'),
    onSuccess: () => {
      msg.success('ยกเลิกการเชื่อม LINE แล้ว');
      void qc.invalidateQueries({ queryKey: ['notification-prefs'] });
    },
    onError: msg.error,
  });

  if (prefs.isPending) return <Card><Skeleton active /></Card>;
  if (prefs.isError) return <ErrorState error={prefs.error} onRetry={() => prefs.refetch()} />;
  const p = prefs.data;

  return (
    <Card title="ช่องทางการแจ้งเตือน">
      <Flex vertical gap={16}>
        <Flex justify="space-between" align="center" gap={12}>
          <div>
            <Typography.Text strong>ในระบบ</Typography.Text>
            <div style={{ fontSize: 13, color: '#6b7280' }}>แสดงที่กระดิ่งด้านบนเสมอ</div>
          </div>
          <Switch checked disabled />
        </Flex>
        <Flex justify="space-between" align="center" gap={12}>
          <div>
            <Typography.Text strong>อีเมล</Typography.Text>
            <div style={{ fontSize: 13, color: '#6b7280' }}>ผลการลงทะเบียน การชำระเงิน การเปลี่ยนแปลงกิจกรรม และการแจ้งเตือนก่อนวันงาน</div>
          </div>
          <Switch checked={p.email} loading={save.isPending} onChange={(email) => save.mutate({ email })} aria-label="แจ้งเตือนทางอีเมล" />
        </Flex>
        <Flex justify="space-between" align="center" gap={12} wrap>
          <div>
            <Typography.Text strong>LINE</Typography.Text>{' '}
            {p.lineLinked ? (
              <Tag color="green">
                เชื่อมแล้ว <ThaiDate value={p.lineLinkedAt} />
              </Tag>
            ) : (
              <Tag>ยังไม่เชื่อม</Tag>
            )}
            <div style={{ fontSize: 13, color: '#6b7280' }}>รับข้อความแจ้งเตือนผ่านบัญชี LINE ทางการของมหาวิทยาลัย</div>
          </div>
          <Flex gap={8} align="center">
            {p.lineLinked ? (
              <>
                <Switch checked={p.line} loading={save.isPending} onChange={(line) => save.mutate({ line })} aria-label="แจ้งเตือนทาง LINE" />
                <Popconfirm title="ยกเลิกการเชื่อมบัญชี LINE?" okText="ยกเลิกการเชื่อม" cancelText="ไม่" onConfirm={() => unlink.mutate()}>
                  <Button size="small" icon={<DisconnectOutlined />}>
                    ยกเลิกการเชื่อม
                  </Button>
                </Popconfirm>
              </>
            ) : (
              <Button icon={<LinkOutlined />} disabled={!p.lineAvailable} loading={link.isPending} onClick={() => link.mutate()}>
                เชื่อมบัญชี LINE
              </Button>
            )}
          </Flex>
        </Flex>
        {!p.lineAvailable && !p.lineLinked && <Typography.Text type="secondary" style={{ fontSize: 13 }}>ระบบยังไม่ได้เปิดใช้การแจ้งเตือนผ่าน LINE</Typography.Text>}
        {code && !p.lineLinked && (
          <Alert
            type="info"
            showIcon
            title={
              <>
                เพิ่มเพื่อน {code.botId ? <b>{code.botId}</b> : 'บัญชี LINE ทางการของระบบ'} แล้วส่งรหัสนี้ในแชต:{' '}
                <Typography.Text copyable strong style={{ fontSize: 20, letterSpacing: 2 }}>
                  {code.code}
                </Typography.Text>
              </>
            }
            description={
              <Flex gap={8} align="center" wrap>
                ใช้ได้ถึง <ThaiDate value={code.expiresAt} time /> ·
                <Button size="small" onClick={() => void prefs.refetch()}>
                  ส่งแล้ว ตรวจสอบสถานะ
                </Button>
              </Flex>
            }
          />
        )}
      </Flex>
    </Card>
  );
}
