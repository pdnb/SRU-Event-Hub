'use client';

import { CheckCircleOutlined, RightOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, Col, Empty, Row, Skeleton, Typography } from 'antd';
import Link from 'next/link';
import type { EventSummaryDto } from '@sru/shared-types';
import { ColumnChart } from '@/components/charts/charts';
import { ThaiDateRange } from '@/components/Format';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/QueryState';
import { List } from '@/components/SimpleList';
import { StatusTag } from '@/components/StatusTag';
import { currentFiscalYear, KpiTiles, monthLabel } from '@/features/reports/ReportViews';
import type { DashboardTask, Overview } from '@/features/reports/types';
import { useCan, useMe } from '@/hooks/useMe';
import { api } from '@/services/api';

/**
 * Role-aware dashboard: "waiting for you" (only what this user can act on, counted inside their
 * data scope), this fiscal year's KPIs for users with report access, and upcoming events.
 */
export default function DashboardPage() {
  const me = useMe();
  const can = useCan();
  const tasks = useQuery({ queryKey: ['dashboard-tasks'], queryFn: () => api.get<DashboardTask[]>('/dashboard/tasks'), refetchInterval: 120_000 });
  const fy = currentFiscalYear();
  const overview = useQuery({ queryKey: ['report-overview', { fiscalYear: fy }], queryFn: () => api.get<Overview>('/reports/overview', { fiscalYear: fy }), enabled: can('report:view') });
  const upcoming = useQuery({
    queryKey: ['admin-events', 'upcoming'],
    queryFn: () => api.getPage<EventSummaryDto>('/events', { perPage: 6, from: new Date().toISOString(), order: 'asc' }),
    enabled: can('event:view'),
  });

  return (
    <>
      <PageHeader title={`สวัสดี ${me.data?.displayName ?? ''}`} description="งานที่รอท่านและภาพรวมในขอบเขตที่ท่านรับผิดชอบ" />

      <Card title="งานที่รอท่าน" style={{ marginBottom: 16 }}>
        {tasks.isPending ? (
          <Skeleton active paragraph={{ rows: 2 }} />
        ) : tasks.isError ? (
          <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} />
        ) : !tasks.data.length ? (
          <Empty image={<CheckCircleOutlined style={{ fontSize: 40, color: '#16a34a' }} />} description="ไม่มีงานค้าง" />
        ) : (
          <Row gutter={[12, 12]}>
            {tasks.data.map((t) => (
              <Col key={t.key} xs={24} sm={12} xl={8}>
                <Link href={t.href} style={{ display: 'block' }}>
                  <Card size="small" hoverable styles={{ body: { display: 'flex', alignItems: 'center', gap: 12 } }}>
                    <Badge count={t.count} overflowCount={999} color={t.tone === 'action' ? '#1f3a8a' : '#6b7280'} />
                    <span style={{ flex: 1, color: '#111827' }}>{t.label}</span>
                    <RightOutlined style={{ color: '#9ca3af' }} />
                  </Card>
                </Link>
              </Col>
            ))}
          </Row>
        )}
      </Card>

      {can('report:view') && (
        <Card
          title={`ภาพรวมปีงบประมาณ ${fy}`}
          extra={<Link href="/admin/reports">รายงานทั้งหมด</Link>}
          style={{ marginBottom: 16 }}
        >
          {overview.isPending ? (
            <Skeleton active />
          ) : overview.isError ? (
            <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
          ) : (
            <>
              <KpiTiles k={overview.data.kpis} />
              <div style={{ marginTop: 16 }}>
                <ColumnChart
                  ariaLabel="ผู้ลงทะเบียนและผู้เข้าร่วมรายเดือน"
                  data={overview.data.trend}
                  category="month"
                  formatCategory={monthLabel}
                  height={200}
                  series={[
                    { key: 'confirmed', label: 'ลงทะเบียน (ยืนยัน)' },
                    { key: 'attended', label: 'เข้าร่วมจริง' },
                  ]}
                />
              </div>
            </>
          )}
        </Card>
      )}

      {can('event:view') && (
        <Card title="กิจกรรมที่กำลังจะมาถึง" extra={<Link href="/admin/events">ดูทั้งหมด</Link>}>
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
