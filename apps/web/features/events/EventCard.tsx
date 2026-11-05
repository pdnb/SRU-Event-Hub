'use client';

import { CalendarOutlined, EnvironmentOutlined, TeamOutlined } from '@ant-design/icons';
import { Card, Flex, Tag, Typography } from 'antd';
import Link from 'next/link';
import type { EventSummaryDto } from '@sru/shared-types';
import { formatMoney } from '@sru/shared-utils';
import { ThaiDateRange } from '@/components/Format';
import { brand } from '@/styles/theme';
import { seatsText } from './format';

export function EventCard({ event }: { event: EventSummaryDto }) {
  const full = event.capacity != null && event.seatsTaken >= event.capacity;
  return (
    <Link href={`/events/${event.code}`} style={{ textDecoration: 'none', display: 'block', height: '100%' }}>
      <Card
        hoverable
        style={{ height: '100%' }}
        cover={
          <div
            style={{
              height: 120,
              background: `linear-gradient(135deg, ${brand.primary}, #3b5bcc)`,
              color: '#fff',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <Flex gap={6} wrap>
              {event.categoryName && <Tag color="gold">{event.categoryName}</Tag>}
              {event.eventTypeName && <Tag>{event.eventTypeName}</Tag>}
            </Flex>
            <small style={{ opacity: 0.85 }}>{event.organizationName}</small>
          </div>
        }
      >
        <Typography.Title level={5} className="line-clamp-2" style={{ marginTop: 0, minHeight: 48 }}>
          {event.titleTh}
        </Typography.Title>
        <Flex vertical gap={4} style={{ color: '#4b5563', fontSize: 14 }}>
          <span>
            <CalendarOutlined /> <ThaiDateRange start={event.startAt} end={event.endAt} />
          </span>
          {event.venueText && (
            <span className="line-clamp-2">
              <EnvironmentOutlined /> {event.venueText}
            </span>
          )}
          <span>
            <TeamOutlined /> {seatsText(event)}
          </span>
        </Flex>
        <Flex gap={6} style={{ marginTop: 12 }} wrap>
          {event.registrationOpen ? (
            <Tag color={full ? 'purple' : 'green'}>{full ? 'เต็ม · รับรายชื่อสำรอง' : 'เปิดรับสมัคร'}</Tag>
          ) : (
            <Tag>{new Date(event.endAt) < new Date() ? 'จัดไปแล้ว' : 'ยังไม่เปิด/ปิดรับสมัคร'}</Tag>
          )}
          <Tag color={event.isPaid ? 'orange' : 'blue'}>{event.isPaid ? (event.minFee ? `เริ่มต้น ${formatMoney(event.minFee)} บาท` : 'มีค่าลงทะเบียน') : 'ไม่มีค่าใช้จ่าย'}</Tag>
        </Flex>
      </Card>
    </Link>
  );
}
