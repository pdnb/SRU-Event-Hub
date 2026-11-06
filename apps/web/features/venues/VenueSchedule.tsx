'use client';

import { CalendarOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, DatePicker, Empty, Flex, InputNumber, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { useState } from 'react';
import { ErrorState } from '@/components/QueryState';
import { api } from '@/services/api';
import dayjs from '@/services/dayjs';
import { BookingDialog } from './BookingDialog';
import { VENUE_TYPE_LABEL, type AvailabilityRow, type VenueType } from './types';

const HOURS = Array.from({ length: 15 }, (_, i) => i + 7); // 07:00 – 21:00

/** Day view: which rooms are free between two times, with a timeline of approved bookings. */
export function VenueSchedule() {
  const [date, setDate] = useState<Dayjs>(() => dayjs().add(1, 'day').startOf('day'));
  const [hours, setHours] = useState<[number, number]>([8, 17]);
  const [minCapacity, setMinCapacity] = useState<number | null>(null);
  const [venueType, setVenueType] = useState<VenueType | undefined>();
  const [booking, setBooking] = useState<string | null>(null);
  const from = date.hour(hours[0]).minute(0);
  const to = date.hour(hours[1]).minute(0);
  const dayFrom = date.hour(HOURS[0]!);
  const dayTo = date.hour(HOURS.at(-1)! + 1);
  const list = useQuery({
    queryKey: ['venue-availability', from.toISOString(), to.toISOString(), minCapacity, venueType],
    queryFn: () => api.get<AvailabilityRow[]>('/venues/availability', { from: from.toISOString(), to: to.toISOString(), minCapacity: minCapacity ?? undefined, venueType }),
    enabled: to.isAfter(from),
  });
  // Timeline shows the whole day so neighbouring bookings are visible too.
  const day = useQuery({
    queryKey: ['venue-availability', 'day', dayFrom.toISOString()],
    queryFn: () => api.get<AvailabilityRow[]>('/venues/availability', { from: dayFrom.toISOString(), to: dayTo.toISOString() }),
  });
  const dayMap = new Map((day.data ?? []).map((v) => [v.id, v.approved]));
  const span = dayTo.diff(dayFrom, 'minute');

  return (
    <Card>
      <Flex gap={12} wrap align="center" style={{ marginBottom: 16 }}>
        <DatePicker value={date} onChange={(d) => d && setDate(d.startOf('day'))} format="ddd D MMM BBBB" allowClear={false} />
        <Space>
          <Select value={hours[0]} onChange={(h) => setHours([h, Math.max(h + 1, hours[1])])} options={HOURS.map((h) => ({ value: h, label: `${String(h).padStart(2, '0')}:00` }))} style={{ width: 90 }} />
          –
          <Select value={hours[1]} onChange={(h) => setHours([Math.min(hours[0], h - 1), h])} options={HOURS.map((h) => ({ value: h + 1, label: `${String(h + 1).padStart(2, '0')}:00` }))} style={{ width: 90 }} />
        </Space>
        <InputNumber placeholder="จำนวนที่นั่งขั้นต่ำ" min={1} value={minCapacity} onChange={setMinCapacity} style={{ width: 170 }} />
        <Select allowClear placeholder="ประเภท" value={venueType} onChange={setVenueType} options={Object.entries(VENUE_TYPE_LABEL).map(([value, label]) => ({ value, label }))} style={{ width: 160 }} />
      </Flex>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <Table<AvailabilityRow>
          rowKey="id"
          size="middle"
          loading={list.isFetching}
          dataSource={list.data ?? []}
          pagination={false}
          scroll={{ x: 960 }}
          locale={{ emptyText: <Empty description="ไม่พบสถานที่ตามเงื่อนไข" /> }}
          columns={[
            {
              title: 'สถานที่',
              width: 240,
              render: (_, v) => (
                <>
                  <div>{v.nameTh}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {[VENUE_TYPE_LABEL[v.venueType], v.capacity ? `${v.capacity} ที่นั่ง` : null, v.building?.nameTh].filter(Boolean).join(' · ')}
                  </Typography.Text>
                </>
              ),
            },
            {
              title: `ตารางการใช้ ${String(HOURS[0]).padStart(2, '0')}:00 – ${HOURS.at(-1)! + 1}:00`,
              render: (_, v) => (
                <div style={{ position: 'relative', height: 26, background: '#f3f4f6', borderRadius: 4, minWidth: 360 }} aria-label="ช่วงเวลาที่ถูกจอง">
                  <div style={{ position: 'absolute', left: `${(from.diff(dayFrom, 'minute') / span) * 100}%`, width: `${(to.diff(from, 'minute') / span) * 100}%`, top: 0, bottom: 0, border: '2px dashed #2563eb', borderRadius: 4 }} />
                  {(dayMap.get(v.id) ?? []).map((b) => {
                    const s = Math.max(0, dayjs(b.startAt).diff(dayFrom, 'minute'));
                    const e = Math.min(span, dayjs(b.endAt).diff(dayFrom, 'minute'));
                    if (e <= 0 || s >= span) return null;
                    return (
                      <Tooltip key={b.id} title={`${dayjs(b.startAt).format('HH:mm')}–${dayjs(b.endAt).format('HH:mm')} ${b.event?.titleTh ?? b.purpose ?? ''}`}>
                        <div style={{ position: 'absolute', left: `${(s / span) * 100}%`, width: `${((e - s) / span) * 100}%`, top: 4, bottom: 4, background: '#dc2626', opacity: 0.75, borderRadius: 3 }} />
                      </Tooltip>
                    );
                  })}
                </div>
              ),
            },
            {
              title: 'ช่วงที่เลือก',
              width: 150,
              render: (_, v) => (
                <>
                  {v.free ? <Tag color="green">ว่าง</Tag> : <Tag color="red">ไม่ว่าง</Tag>}
                  {v.pending > 0 && <div style={{ fontSize: 12, color: '#a16207' }}>มีคำขอรอพิจารณา {v.pending}</div>}
                  {v.autoApprove && <div style={{ fontSize: 12, color: '#6b7280' }}>อนุมัติอัตโนมัติ</div>}
                </>
              ),
            },
            {
              title: '',
              width: 100,
              render: (_, v) => (
                <Button size="small" type={v.free ? 'primary' : 'default'} disabled={!v.free} icon={<CalendarOutlined />} onClick={() => setBooking(v.id)}>
                  จอง
                </Button>
              ),
            },
          ]}
        />
      )}
      <BookingDialog kind="venue" open={!!booking} onClose={() => setBooking(null)} defaultTargetId={booking ?? undefined} defaultRange={[from.toISOString(), to.toISOString()]} />
    </Card>
  );
}
