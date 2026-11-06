'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, Empty, Progress, Segmented, Table, Typography } from 'antd';
import Link from 'next/link';
import { useState } from 'react';
import { ThaiDateRange } from '@/components/Format';
import { ErrorState } from '@/components/QueryState';
import { StatusTag } from '@/components/StatusTag';
import { api } from '@/services/api';
import type { DeskEvent } from './types';

/** Events the user can run a check-in desk / badge printing for (scope + personnel assignment). */
export function DeskEventPicker({ purpose, hrefFor, actionLabel }: { purpose: 'checkin' | 'badge' | 'certificate' | 'evaluation'; hrefFor: (id: string) => string; actionLabel: string }) {
  const [when, setWhen] = useState<'now' | 'all'>('now');
  const [now] = useState(() => Date.now());
  const list = useQuery({ queryKey: ['desk-events', purpose], queryFn: () => api.get<DeskEvent[]>('/me/desk-events', { purpose }) });
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  const rows = (list.data ?? []).filter((e) => when === 'all' || (new Date(e.endAt).getTime() >= now - 86400_000 && new Date(e.startAt).getTime() <= now + 14 * 86400_000));

  return (
    <Card
      extra={
        <Segmented
          value={when}
          onChange={(v) => setWhen(v as 'now' | 'all')}
          options={[
            { value: 'now', label: 'วันนี้และใกล้ถึง' },
            { value: 'all', label: 'ทั้งหมด' },
          ]}
        />
      }
      title="เลือกกิจกรรม"
    >
      <Table<DeskEvent>
        rowKey="id"
        loading={list.isPending}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 820 }}
        locale={{ emptyText: <Empty description={when === 'now' ? 'ไม่มีกิจกรรมที่กำลังจะจัดใน 14 วัน' : 'ไม่มีกิจกรรมในความรับผิดชอบ'} /> }}
        columns={[
          {
            title: 'กิจกรรม',
            render: (_, e) => (
              <>
                <Link href={hrefFor(e.id)}>{e.titleTh}</Link>
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    {e.code} · {e.organizationName}
                    {e.venueText ? ` · ${e.venueText}` : ''}
                  </Typography.Text>
                </div>
              </>
            ),
          },
          { title: 'วันเวลา', width: 230, render: (_, e) => <ThaiDateRange start={e.startAt} end={e.endAt} /> },
          { title: 'สถานะ', width: 150, render: (_, e) => (e.isOpen ? <Badge status="processing" text="เปิดเช็กอินอยู่" /> : <StatusTag status={e.status} />) },
          {
            title: 'เช็กอินแล้ว',
            width: 170,
            render: (_, e) => <Progress percent={e.confirmed ? Math.round((e.checkedIn / e.confirmed) * 100) : 0} format={() => `${e.checkedIn}/${e.confirmed}`} size="small" />,
          },
          {
            title: '',
            width: 120,
            render: (_, e) => (
              <Link href={hrefFor(e.id)}>
                <Button type={e.isOpen ? 'primary' : 'default'}>{actionLabel}</Button>
              </Link>
            ),
          },
        ]}
      />
    </Card>
  );
}
