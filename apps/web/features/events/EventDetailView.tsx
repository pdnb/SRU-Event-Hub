'use client';

import { CalendarOutlined, EnvironmentOutlined, TeamOutlined } from '@ant-design/icons';
import { Breadcrumb, Card, Col, Descriptions, Flex, Row, Tag, Typography } from 'antd';
import Link from 'next/link';
import type { EventDetailDto } from '@sru/shared-types';
import { Money, ThaiDate, ThaiDateRange } from '@/components/Format';
import { GroupRegisterCard } from '@/features/groups/GroupRegisterCard';
import { RegisterPanel } from '@/features/registration/RegisterPanel';
import { brand } from '@/styles/theme';
import { seatsText } from './format';
import { ShareButtons } from './ShareButtons';

export function EventDetailView({ event: e }: { event: EventDetailDto }) {
  return (
    <div className="page-container" style={{ paddingTop: 20 }}>
      <Breadcrumb items={[{ title: <Link href="/">หน้าแรก</Link> }, { title: <Link href="/events">กิจกรรม</Link> }, { title: e.code }]} style={{ marginBottom: 16 }} />
      <div style={{ background: `linear-gradient(120deg, ${brand.sidebar}, ${brand.primary})`, color: '#fff', borderRadius: 12, padding: 28 }}>
        <Flex gap={6} wrap style={{ marginBottom: 8 }}>
          {e.categoryName && <Tag color="gold">{e.categoryName}</Tag>}
          {e.eventTypeName && <Tag>{e.eventTypeName}</Tag>}
          <Tag color={e.isPaid ? 'orange' : 'blue'}>{e.isPaid ? 'มีค่าลงทะเบียน' : 'ไม่มีค่าใช้จ่าย'}</Tag>
        </Flex>
        <h1 style={{ margin: 0, fontSize: 'clamp(22px, 3vw, 32px)', lineHeight: 1.3 }}>{e.titleTh}</h1>
        {e.titleEn && <div style={{ opacity: 0.8, marginTop: 4 }}>{e.titleEn}</div>}
        <Flex gap={24} wrap style={{ marginTop: 16, opacity: 0.95 }}>
          <span>
            <CalendarOutlined /> <ThaiDateRange start={e.startAt} end={e.endAt} />
          </span>
          {e.venueText && (
            <span>
              <EnvironmentOutlined /> {e.venueText}
            </span>
          )}
          <span>
            <TeamOutlined /> {seatsText(e)}
          </span>
        </Flex>
      </div>

      <Row gutter={[24, 24]} style={{ marginTop: 24 }}>
        <Col xs={24} lg={15}>
          <Card title="รายละเอียดกิจกรรม">
            {e.description ? <p className="pre-wrap" style={{ marginTop: 0 }}>{e.description}</p> : <p>-</p>}
            {e.objectives && (
              <>
                <h3>วัตถุประสงค์</h3>
                <p className="pre-wrap">{e.objectives}</p>
              </>
            )}
            {e.conditions && (
              <>
                <h3>เงื่อนไขการเข้าร่วม</h3>
                <p className="pre-wrap">{e.conditions}</p>
              </>
            )}
          </Card>
          <Card title="ข้อมูลกิจกรรม" style={{ marginTop: 16 }}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="รหัสกิจกรรม">{e.code}</Descriptions.Item>
              <Descriptions.Item label="หน่วยงานผู้จัด">{e.organizationName}</Descriptions.Item>
              <Descriptions.Item label="กลุ่มเป้าหมาย">{e.targetAudience ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="ผู้มีสิทธิ์ลงทะเบียน">{e.participantTypes.length ? e.participantTypes.map((p) => <Tag key={p.id}>{p.nameTh}</Tag>) : 'ทุกประเภท'}</Descriptions.Item>
              <Descriptions.Item label="เปิดรับสมัคร">
                <ThaiDate value={e.registrationOpenAt} time /> – <ThaiDate value={e.registrationCloseAt} time />
              </Descriptions.Item>
              <Descriptions.Item label="ค่าลงทะเบียน">
                {e.isPaid ? (
                  <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                    {e.feeRates.map((r) => (
                      <li key={r.id}>
                        {r.nameTh}
                        {r.participantTypeName ? ` (${r.participantTypeName})` : ''}: <Money value={r.amount} />
                        {(r.validFrom || r.validUntil) && (
                          <Typography.Text type="secondary">
                            {' '}
                            {r.validFrom ? <>ตั้งแต่ <ThaiDate value={r.validFrom} /> </> : null}
                            {r.validUntil ? <>ถึง <ThaiDate value={new Date(new Date(r.validUntil).getTime() - 1)} /></> : null}
                          </Typography.Text>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  'ไม่มีค่าใช้จ่าย'
                )}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} lg={9}>
          <RegisterPanel event={e} />
          <GroupRegisterCard event={e} />
          <Card size="small" style={{ marginTop: 16 }} title="แชร์กิจกรรม">
            <ShareButtons title={e.titleTh} path={`/events/${e.code}`} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
