'use client';

import { IdcardOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, Flex, Tabs, Tag, Typography } from 'antd';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ThaiDateRange } from '@/components/Format';
import { PageHeader } from '@/components/PageHeader';
import { QueryState } from '@/components/QueryState';
import { AttendanceTable } from '@/features/checkin/AttendanceTable';
import { CheckinDashboard } from '@/features/checkin/CheckinDashboard';
import { CheckinDesk } from '@/features/checkin/CheckinDesk';
import { CheckinRecords } from '@/features/checkin/CheckinRecords';
import { CheckinSettingsPanel } from '@/features/checkin/CheckinSettingsPanel';
import { useCheckinLive, type LiveState } from '@/features/checkin/live';
import type { CheckinSettings, CheckinStats } from '@/features/checkin/types';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';

const LIVE: Record<LiveState, { status: 'processing' | 'default' | 'error' | 'warning'; text: string }> = {
  live: { status: 'processing', text: 'เรียลไทม์' },
  connecting: { status: 'default', text: 'กำลังเชื่อมต่อ…' },
  offline: { status: 'warning', text: 'ไม่ได้เชื่อมต่อเรียลไทม์' },
  denied: { status: 'error', text: 'ไม่มีสิทธิ์ดูแบบเรียลไทม์' },
};

export default function CheckinEventPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const can = useCan();
  const settings = useQuery({ queryKey: ['checkin-settings', eventId], queryFn: () => api.get<CheckinSettings>(`/events/${eventId}/checkin/settings`) });
  const stats = useQuery({ queryKey: ['checkin-stats', eventId], queryFn: () => api.get<CheckinStats>(`/events/${eventId}/checkin/stats`), refetchInterval: 60_000 });
  const live = useCheckinLive(eventId, [
    ['checkin-stats', eventId],
    ['checkin-records', eventId],
    ['attendance', eventId],
  ]);

  return (
    <QueryState query={settings}>
      {(s) => (
        <>
          <PageHeader
            title={s.event.titleTh}
            description={
              <Flex gap={8} align="center" wrap>
                <Typography.Text code>{s.event.code}</Typography.Text>
                <ThaiDateRange start={s.event.startAt} end={s.event.endAt} />
                {s.isOpen ? <Tag color="green">เปิดเช็กอินอยู่</Tag> : <Tag>ไม่อยู่ในช่วงเวลาเช็กอิน</Tag>}
                <Badge status={LIVE[live].status} text={LIVE[live].text} />
              </Flex>
            }
            breadcrumb={[{ title: 'ตรวจสอบการเข้าร่วม', href: '/admin/checkin' }, { title: s.event.code }]}
            actions={
              <>
                <Card size="small" styles={{ body: { padding: '4px 16px' } }}>
                  <Typography.Text type="secondary">เช็กอินแล้ว </Typography.Text>
                  <Typography.Text strong style={{ fontSize: 22 }}>
                    {stats.data?.checkedIn ?? '–'}
                  </Typography.Text>
                  <Typography.Text type="secondary"> / {stats.data?.confirmed ?? '–'}</Typography.Text>
                </Card>
                {can('badge:view') && (
                  <Link href={`/admin/badges/${eventId}`}>
                    <Button icon={<IdcardOutlined />}>ป้ายชื่อ</Button>
                  </Link>
                )}
              </>
            }
          />
          <Tabs
            destroyOnHidden={false}
            items={[
              ...(can('checkin:create') ? [{ key: 'desk', label: 'จุดเช็กอิน', children: <CheckinDesk eventId={eventId} settings={s} /> }] : []),
              { key: 'live', label: 'ภาพรวม', children: <CheckinDashboard eventId={eventId} /> },
              { key: 'records', label: 'บันทึกการเช็กอิน', children: <Card><CheckinRecords eventId={eventId} locations={s.locations} /></Card> },
              ...(can('attendance:view') ? [{ key: 'attendance', label: 'การเข้าร่วม', children: <Card><AttendanceTable eventId={eventId} schedules={s.schedules} /></Card> }] : []),
              { key: 'settings', label: 'ตั้งค่า', children: <CheckinSettingsPanel eventId={eventId} settings={s} /> },
            ]}
          />
        </>
      )}
    </QueryState>
  );
}
