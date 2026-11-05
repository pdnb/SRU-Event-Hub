'use client';

import { CalendarOutlined, CheckSquareOutlined, ProjectOutlined, TeamOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Card, Col, Row, Statistic, Typography } from 'antd';
import { List } from '@/components/SimpleList';
import Link from 'next/link';
import type { EventSummaryDto } from '@sru/shared-types';
import { ThaiDateRange } from '@/components/Format';
import { PageHeader } from '@/components/PageHeader';
import { StatusTag } from '@/components/StatusTag';
import { useCan, useMe } from '@/hooks/useMe';
import { api } from '@/services/api';

/**
 * Phase 1 dashboard: counts derived from the scoped event list + pending approvals.
 * Role-specific dashboards (executive, finance, organizer, coordinator) arrive with their modules.
 */
function useEventCount(status: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['admin-events', 'count', status],
    queryFn: () => api.getPage<EventSummaryDto>('/events', { perPage: 1, status }),
    enabled,
  });
}

export default function DashboardPage() {
  const me = useMe();
  const can = useCan();
  const canEvents = can('event:view');
  const all = useEventCount(undefined, canEvents);
  const open = useEventCount('REGISTRATION_OPEN', canEvents);
  const pendingApproval = useEventCount('PENDING_APPROVAL', canEvents);
  const upcoming = useQuery({
    queryKey: ['admin-events', 'upcoming'],
    queryFn: () => api.getPage<EventSummaryDto>('/events', { perPage: 6, from: new Date().toISOString(), order: 'asc' }),
    enabled: canEvents,
  });
  const myApprovals = useQuery({ queryKey: ['approvals-pending'], queryFn: () => api.get<unknown[]>('/approvals/pending'), enabled: can('approval:approve') });

  const stats = [
    { title: 'กิจกรรมทั้งหมด', value: all.data?.meta.total, icon: <ProjectOutlined />, show: canEvents },
    { title: 'กำลังเปิดรับสมัคร', value: open.data?.meta.total, icon: <TeamOutlined />, show: canEvents },
    { title: 'อยู่ระหว่างอนุมัติ', value: pendingApproval.data?.meta.total, icon: <CalendarOutlined />, show: canEvents },
    { title: 'รอท่านพิจารณา', value: myApprovals.data?.length, icon: <CheckSquareOutlined />, show: can('approval:approve'), href: '/admin/approvals' },
  ].filter((s) => s.show);

  return (
    <>
      <PageHeader title={`สวัสดี ${me.data?.displayName ?? ''}`} description="ภาพรวมกิจกรรมในขอบเขตที่ท่านรับผิดชอบ" />
      <Row gutter={[16, 16]}>
        {stats.map((s) => (
          <Col key={s.title} xs={12} lg={6}>
            <Card>
              {s.href ? (
                <Link href={s.href}>
                  <Statistic title={s.title} value={s.value ?? '-'} prefix={s.icon} />
                </Link>
              ) : (
                <Statistic title={s.title} value={s.value ?? '-'} prefix={s.icon} />
              )}
            </Card>
          </Col>
        ))}
      </Row>
      {canEvents && (
        <Card title="กิจกรรมที่กำลังจะมาถึง" style={{ marginTop: 16 }} extra={<Link href="/admin/events">ดูทั้งหมด</Link>}>
          <List
            loading={upcoming.isPending}
            dataSource={upcoming.data?.items ?? []}
            locale={{ emptyText: 'ไม่มีกิจกรรมที่กำลังจะมาถึง' }}
            renderItem={(e) => (
              <List.Item extra={<StatusTag status={e.status} />}>
                <List.Item.Meta
                  title={<Link href={`/admin/events/${e.id}`}>{e.titleTh}</Link>}
                  description={
                    <Typography.Text type="secondary">
                      <ThaiDateRange start={e.startAt} end={e.endAt} /> · {e.organizationName} · ผู้สมัคร {e.seatsTaken}
                      {e.capacity ? `/${e.capacity}` : ''}
                    </Typography.Text>
                  }
                />
              </List.Item>
            )}
          />
        </Card>
      )}
    </>
  );
}
