'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, Col, Empty, Flex, Progress, Row, Statistic, Table, Tag, Typography } from 'antd';
import { ThaiDate } from '@/components/Format';
import { ErrorState } from '@/components/QueryState';
import { api } from '@/services/api';
import { ACTION_LABEL, METHOD_LABEL, type CheckinStats } from './types';

const time = (iso: string) => new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** Live counters for the event (refreshed by the socket hook on the page + a slow poll as a fallback). */
export function CheckinDashboard({ eventId }: { eventId: string }) {
  const stats = useQuery({
    queryKey: ['checkin-stats', eventId],
    queryFn: () => api.get<CheckinStats>(`/events/${eventId}/checkin/stats`),
    refetchInterval: 60_000,
  });
  if (stats.isError) return <ErrorState error={stats.error} onRetry={() => stats.refetch()} />;
  const s = stats.data;
  const pct = s && s.confirmed ? Math.round((s.checkedIn / s.confirmed) * 100) : 0;
  const maxHour = Math.max(1, ...(s?.hourly.map((h) => h.count) ?? [1]));

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} md={8}>
        <Card loading={stats.isPending}>
          <Flex vertical align="center" gap={8}>
            <Progress type="dashboard" percent={pct} size={180} format={() => <span style={{ fontSize: 30 }}>{s?.checkedIn ?? 0}</span>} />
            <Typography.Text type="secondary">จากผู้ลงทะเบียนที่ยืนยันแล้ว {s?.confirmed ?? 0} คน</Typography.Text>
          </Flex>
        </Card>
      </Col>
      <Col xs={24} md={16}>
        <Card loading={stats.isPending}>
          <Row gutter={[16, 16]}>
            <Col xs={12} md={6}>
              <Statistic title="เช็กอินแล้ว" value={s?.checkedIn} styles={{ content: { color: '#16a34a' } }} />
            </Col>
            <Col xs={12} md={6}>
              <Statistic title="ยังไม่มา" value={s?.notArrived} />
            </Col>
            <Col xs={12} md={6}>
              <Statistic title="มาสาย" value={s?.late} styles={{ content: { color: '#d97706' } }} />
            </Col>
            <Col xs={12} md={6}>
              <Statistic title="รอชำระเงิน" value={s?.pendingPayment} />
            </Col>
          </Row>
          <Typography.Title level={5} style={{ marginTop: 20 }}>
            เช็กอินรายชั่วโมง
          </Typography.Title>
          {s?.hourly.length ? (
            <Flex align="flex-end" gap={6} style={{ height: 120 }} role="img" aria-label="จำนวนผู้เช็กอินรายชั่วโมง">
              {s.hourly.map((h) => (
                <Flex key={h.hour} vertical align="center" justify="flex-end" style={{ flex: 1, height: '100%' }}>
                  <Typography.Text style={{ fontSize: 12 }}>{h.count}</Typography.Text>
                  <div style={{ width: '100%', maxWidth: 40, height: `${(h.count / maxHour) * 80}%`, background: '#1f3a8a', borderRadius: 4 }} />
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {time(h.hour)}
                  </Typography.Text>
                </Flex>
              ))}
            </Flex>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="ยังไม่มีการเช็กอิน" />
          )}
        </Card>
      </Col>

      <Col xs={24} md={12}>
        <Card title="ตามประเภทผู้เข้าร่วม" loading={stats.isPending}>
          {s?.byParticipantType.map((t) => (
            <div key={t.code} style={{ marginBottom: 8 }}>
              <Flex justify="space-between">
                <span>{t.name}</span>
                <span>
                  {t.present}/{t.registered}
                </span>
              </Flex>
              <Progress percent={t.registered ? Math.round((t.present / t.registered) * 100) : 0} showInfo={false} />
            </div>
          ))}
        </Card>
      </Col>
      <Col xs={24} md={12}>
        <Card title="ตามจุดเช็กอิน / ช่วงกิจกรรม" loading={stats.isPending}>
          {s?.byLocation.map((l) => (
            <Flex key={l.id ?? 'none'} justify="space-between" style={{ padding: '4px 0' }}>
              <span>
                {l.name} {!l.isActive && <Tag>ปิด</Tag>}
              </span>
              <strong>{l.count}</strong>
            </Flex>
          ))}
          {!!s?.bySchedule.length && (
            <>
              <Typography.Title level={5} style={{ marginTop: 12 }}>
                ช่วงกิจกรรม
              </Typography.Title>
              {s.bySchedule.map((x) => (
                <Flex key={x.id} justify="space-between" style={{ padding: '4px 0' }}>
                  <span>
                    {x.title} <Typography.Text type="secondary">({time(x.startAt)})</Typography.Text>
                  </span>
                  <strong>{x.count}</strong>
                </Flex>
              ))}
            </>
          )}
          {!s?.byLocation.length && !s?.bySchedule.length && <Typography.Text type="secondary">ยังไม่ได้กำหนดจุดเช็กอิน</Typography.Text>}
        </Card>
      </Col>

      <Col span={24}>
        <Card title="รายการล่าสุด" loading={stats.isPending}>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={s?.recent}
            scroll={{ x: 760 }}
            columns={[
              { title: 'เวลา', dataIndex: 'occurredAt', width: 170, render: (d) => <ThaiDate value={d} time /> },
              { title: 'ชื่อ', dataIndex: 'fullName', render: (n, r) => (r.undone ? <Typography.Text delete>{n}</Typography.Text> : n) },
              { title: 'รายการ', dataIndex: 'action', width: 120, render: (a) => <Tag color={ACTION_LABEL[a]?.color}>{ACTION_LABEL[a]?.text}</Tag> },
              { title: 'วิธี', dataIndex: 'method', width: 100, render: (m) => METHOD_LABEL[m] },
              { title: 'จุด', dataIndex: 'location', render: (l, r) => [l, r.schedule].filter(Boolean).join(' · ') || '-' },
              { title: 'เจ้าหน้าที่', dataIndex: 'actor', render: (a) => a ?? '-' },
            ]}
          />
        </Card>
      </Col>
    </Row>
  );
}
