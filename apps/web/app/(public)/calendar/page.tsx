'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge, Calendar, Card, Grid, List, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import Link from 'next/link';
import { useState } from 'react';
import type { EventSummaryDto } from '@sru/shared-types';
import { ThaiDateRange } from '@/components/Format';
import { api } from '@/services/api';
import dayjs from '@/services/dayjs';

/** Public calendar: loads every published event overlapping the visible month. */
export default function CalendarPage() {
  const screens = Grid.useBreakpoint();
  const [month, setMonth] = useState(() => dayjs().startOf('month'));
  const [selected, setSelected] = useState<Dayjs>(() => dayjs());
  const from = month.startOf('month').subtract(7, 'day');
  const to = month.endOf('month').add(7, 'day');
  const events = useQuery({
    queryKey: ['calendar', from.toISOString()],
    queryFn: () => api.public.events({ from: from.toISOString(), to: to.toISOString(), perPage: 100, order: 'asc' }),
  });

  const on = (d: Dayjs) => (events.data?.items ?? []).filter((e) => !d.isBefore(dayjs(e.startAt), 'day') && !d.isAfter(dayjs(e.endAt), 'day'));
  const dayEvents = on(selected);

  return (
    <div className="page-container" style={{ paddingTop: 24 }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>ปฏิทินกิจกรรม</h1>
      <p style={{ color: '#6b7280', marginTop: 0 }}>เลือกวันเพื่อดูกิจกรรมในวันนั้น</p>
      <Card loading={events.isPending && !events.data}>
        <Calendar
          fullscreen={!!screens.md}
          value={selected}
          onSelect={(d) => setSelected(d)}
          onPanelChange={(d) => setMonth(d.startOf('month'))}
          cellRender={(d, info) => {
            if (info.type !== 'date') return info.originNode;
            const list = on(d);
            if (!list.length) return null;
            return screens.md ? (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {list.slice(0, 3).map((e) => (
                  <li key={e.id} style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    <Badge status={e.registrationOpen ? 'success' : 'processing'} text={<small>{e.titleTh}</small>} />
                  </li>
                ))}
                {list.length > 3 && <small>+{list.length - 3} กิจกรรม</small>}
              </ul>
            ) : (
              <Badge count={list.length} size="small" />
            );
          }}
        />
      </Card>
      <Card title={`กิจกรรมวันที่ ${selected.format('D MMMM BBBB')}`} style={{ marginTop: 16 }}>
        <List<EventSummaryDto>
          dataSource={dayEvents}
          locale={{ emptyText: 'ไม่มีกิจกรรมในวันนี้' }}
          renderItem={(e) => (
            <List.Item>
              <List.Item.Meta
                title={<Link href={`/events/${e.code}`}>{e.titleTh}</Link>}
                description={
                  <Typography.Text type="secondary">
                    <ThaiDateRange start={e.startAt} end={e.endAt} /> · {e.organizationName}
                  </Typography.Text>
                }
              />
            </List.Item>
          )}
        />
      </Card>
    </div>
  );
}
