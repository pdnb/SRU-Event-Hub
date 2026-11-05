'use client';

import { ArrowRightOutlined } from '@ant-design/icons';
import { Button, Col, Empty, Flex, Row } from 'antd';
import Link from 'next/link';
import type { EventSummaryDto } from '@sru/shared-types';
import { EventCard } from '@/features/events/EventCard';
import { brand } from '@/styles/theme';

export function HomeView({ featured, open, upcoming }: { featured: EventSummaryDto[]; open: EventSummaryDto[]; upcoming: EventSummaryDto[] }) {
  return (
    <>
      <section style={{ background: `linear-gradient(120deg, ${brand.sidebar}, ${brand.primary})`, color: '#fff', padding: '56px 0' }}>
        <div className="page-container">
          <h1 style={{ fontSize: 'clamp(28px, 4vw, 40px)', margin: 0, lineHeight: 1.25 }}>
            กิจกรรมทั้งหมดของมหาวิทยาลัย
            <br />
            <span style={{ color: brand.accent }}>ในที่เดียว</span>
          </h1>
          <p style={{ fontSize: 18, opacity: 0.9, maxWidth: 640 }}>
            ค้นหา ลงทะเบียน และติดตามกิจกรรมจากทุกคณะ สำนัก และหน่วยงานของมหาวิทยาลัยราชภัฏสุราษฎร์ธานี
          </p>
          <Flex gap={12} wrap>
            <Link href="/events?tab=open">
              <Button size="large" type="primary" style={{ background: brand.accent, borderColor: brand.accent, color: brand.sidebar, fontWeight: 600 }}>
                ดูกิจกรรมที่เปิดรับสมัคร
              </Button>
            </Link>
            <Link href="/calendar">
              <Button size="large" ghost>
                ปฏิทินกิจกรรม
              </Button>
            </Link>
          </Flex>
        </div>
      </section>

      <div className="page-container">
        {featured.length > 0 && <Section title="กิจกรรมแนะนำ" events={featured} href="/events?featured=true" />}
        <Section title="กำลังเปิดรับสมัคร" events={open} href="/events?tab=open" />
        <Section title="กิจกรรมที่กำลังจะจัด" events={upcoming} href="/events?tab=upcoming" />
      </div>
    </>
  );
}

function Section({ title, events, href }: { title: string; events: EventSummaryDto[]; href: string }) {
  return (
    <section style={{ marginTop: 40 }}>
      <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 24 }}>{title}</h2>
        <Link href={href}>
          ดูทั้งหมด <ArrowRightOutlined />
        </Link>
      </Flex>
      {events.length ? (
        <Row gutter={[16, 16]}>
          {events.map((e) => (
            <Col key={e.id} xs={24} sm={12} lg={8}>
              <EventCard event={e} />
            </Col>
          ))}
        </Row>
      ) : (
        <Empty description="ยังไม่มีกิจกรรมในขณะนี้" />
      )}
    </section>
  );
}
