'use client';

import { PlusOutlined } from '@ant-design/icons';
import { Button, Card, Space, Typography } from 'antd';
import { useState } from 'react';
import { BookingDialog } from './BookingDialog';
import { BookingList } from './BookingList';

/** An event's venue + equipment bookings, with request buttons pre-filled with the event's time. */
export function EventBookingsTab({ eventId, startAt, endAt, venueId, editable }: { eventId: string; startAt: string; endAt: string; venueId: string | null; editable: boolean }) {
  const [dialog, setDialog] = useState<'venue' | 'resource' | null>(null);
  return (
    <Card
      title="การจองสถานที่และอุปกรณ์"
      extra={
        editable && (
          <Space wrap>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setDialog('venue')}>
              จองสถานที่
            </Button>
            <Button icon={<PlusOutlined />} onClick={() => setDialog('resource')}>
              ยืมอุปกรณ์
            </Button>
          </Space>
        )
      }
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
        การจองผูกกับกิจกรรมนี้ — หากยกเลิกกิจกรรม การจองทั้งหมดจะถูกยกเลิกอัตโนมัติ · ถ้าเลื่อนกำหนดการ กรุณาจองช่วงเวลาใหม่และยกเลิกรายการเดิม
      </Typography.Paragraph>
      <BookingList view="event" eventId={eventId} canCancel={editable} />
      <BookingDialog kind={dialog ?? 'venue'} open={!!dialog} onClose={() => setDialog(null)} eventId={eventId} defaultRange={[startAt, endAt]} defaultTargetId={dialog === 'venue' ? (venueId ?? undefined) : undefined} />
    </Card>
  );
}
