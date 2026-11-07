'use client';

import { DownloadOutlined, SearchOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, Card, Col, DatePicker, Flex, Input, Row, Select, Statistic, Table, Typography } from 'antd';
import Link from 'next/link';
import { useState } from 'react';
import { BarList, ColumnChart } from '@/components/charts/charts';
import { Money, ThaiDate } from '@/components/Format';
import { QueryState } from '@/components/QueryState';
import { StatusTag } from '@/components/StatusTag';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';
import dayjs, { DATE_FMT } from '@/services/dayjs';
import { downloadFile } from '@/services/download';
import type { EventReportRow, FinanceReport, Overview, ParticipantReport, ReportFilters } from './types';

export const monthLabel = (m: string) => dayjs(`${m}-01`).format('MMM BB');
const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Current fiscal year in B.E. (starts 1 October). */
export function currentFiscalYear(d = new Date()) {
  return d.getFullYear() + 543 + (d.getMonth() >= 9 ? 1 : 0);
}

export function ReportFilterBar({ value, onChange }: { value: ReportFilters; onChange: (f: ReportFilters) => void }) {
  const orgs = useQuery({ queryKey: ['orgs-public'], queryFn: () => api.public.organizations(), staleTime: 10 * 60_000 });
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.public.lookups(), staleTime: 600_000 });
  const fy = currentFiscalYear();
  const custom = !!value.from;
  return (
    <Flex gap={12} wrap align="center">
      <Select
        style={{ width: 180 }}
        value={custom ? 'custom' : (value.fiscalYear ?? fy)}
        onChange={(v) => onChange(v === 'custom' ? { ...value, fiscalYear: undefined, from: dayjs().startOf('month').toISOString(), to: dayjs().add(1, 'month').startOf('month').toISOString() } : { ...value, fiscalYear: Number(v), from: undefined, to: undefined })}
        options={[...[0, 1, 2, 3].map((i) => ({ value: fy - i, label: `ปีงบประมาณ ${fy - i}` })), { value: 'custom', label: 'กำหนดช่วงเอง' }]}
      />
      {custom && (
        <DatePicker.RangePicker
          format={DATE_FMT}
          value={[dayjs(value.from), dayjs(value.to).subtract(1, 'day')]}
          onChange={(r) => r?.[0] && r[1] && onChange({ ...value, from: r[0].startOf('day').toISOString(), to: r[1].add(1, 'day').startOf('day').toISOString() })}
          allowClear={false}
        />
      )}
      <Select
        allowClear
        showSearch
        optionFilterProp="label"
        placeholder="ทุกหน่วยงาน (ในขอบเขตสิทธิ์)"
        style={{ minWidth: 260 }}
        value={value.organizationId}
        onChange={(organizationId) => onChange({ ...value, organizationId })}
        options={(orgs.data ?? []).map((o) => ({ value: o.id, label: o.nameTh }))}
      />
      <Select
        allowClear
        placeholder="ทุกหมวดหมู่"
        style={{ minWidth: 180 }}
        value={value.categoryId}
        onChange={(categoryId) => onChange({ ...value, categoryId })}
        options={(lookups.data?.categories ?? []).map((c: { id: string; nameTh: string }) => ({ value: c.id, label: c.nameTh }))}
      />
    </Flex>
  );
}

export function KpiTiles({ k }: { k: Overview['kpis'] }) {
  const tiles: { title: string; value: string | number; suffix?: string; note?: string }[] = [
    { title: 'กิจกรรม', value: k.events - k.cancelled, note: `จัดแล้ว ${k.held} · กำลังจะจัด ${k.upcoming}${k.cancelled ? ` · ยกเลิก ${k.cancelled}` : ''}` },
    { title: 'ผู้ลงทะเบียน', value: k.confirmed.toLocaleString('th-TH'), note: `${k.uniqueParticipants.toLocaleString('th-TH')} คนไม่ซ้ำ` },
    { title: 'อัตราการเข้าร่วม', value: k.attendanceRate ?? '-', suffix: k.attendanceRate != null ? '%' : undefined, note: `เข้าร่วมจริง ${k.attended.toLocaleString('th-TH')} คน (กิจกรรมที่จบแล้ว)` },
    { title: 'รายรับสุทธิ (บาท)', value: baht(k.net), note: k.refunded ? `รับ ${baht(k.collected)} · คืน ${baht(k.refunded)}` : undefined },
    { title: 'ความพึงพอใจ', value: k.satisfaction ?? '-', suffix: k.satisfaction != null ? '/ 5' : undefined, note: `ผู้ตอบแบบประเมิน ${k.responses.toLocaleString('th-TH')}` },
    { title: 'เกียรติบัตร', value: k.certificates.toLocaleString('th-TH'), note: 'ฉบับที่ออกและยังมีผล' },
  ];
  return (
    <Row gutter={[16, 16]}>
      {tiles.map((t) => (
        <Col key={t.title} xs={12} md={8} xl={4}>
          <Card size="small" style={{ height: '100%' }}>
            <Statistic title={t.title} value={t.value} suffix={t.suffix} />
            {t.note && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t.note}</Typography.Text>}
          </Card>
        </Col>
      ))}
    </Row>
  );
}

export function OverviewReport({ filters }: { filters: ReportFilters }) {
  const q = useQuery({ queryKey: ['report-overview', filters], queryFn: () => api.get<Overview>('/reports/overview', filters), placeholderData: keepPreviousData });
  return (
    <QueryState query={q}>
      {(d) => (
        <Flex vertical gap={16}>
          <Typography.Text type="secondary">ช่วงเวลา: {d.period.label} (ตามวันเริ่มกิจกรรม)</Typography.Text>
          <KpiTiles k={d.kpis} />
          <Card title="ผู้ลงทะเบียนและผู้เข้าร่วมรายเดือน">
            <ColumnChart
              ariaLabel="ผู้ลงทะเบียนและผู้เข้าร่วมรายเดือน"
              data={d.trend}
              category="month"
              formatCategory={monthLabel}
              series={[
                { key: 'confirmed', label: 'ลงทะเบียน (ยืนยัน)' },
                { key: 'attended', label: 'เข้าร่วมจริง' },
              ]}
            />
          </Card>
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <Card title="ผู้ลงทะเบียนตามหน่วยงานผู้จัด" style={{ height: '100%' }}>
                <BarList valueLabel="ผู้ลงทะเบียน" items={d.byOrganization.map((o) => ({ name: o.name, value: o.confirmed, hint: `${o.events} กิจกรรม` }))} />
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card title="กิจกรรมตามหมวดหมู่" style={{ height: '100%' }}>
                <BarList valueLabel="จำนวนกิจกรรม" items={d.byCategory.map((c) => ({ name: c.name, value: c.events, hint: `${c.confirmed.toLocaleString('th-TH')} คน` }))} />
              </Card>
            </Col>
          </Row>
          <Card title="ประเภทผู้เข้าร่วม">
            <Table
              size="small"
              pagination={false}
              rowKey="name"
              dataSource={d.byParticipantType}
              scroll={{ x: 480 }}
              columns={[
                { title: 'ประเภท', dataIndex: 'name' },
                { title: 'ลงทะเบียน', align: 'right', render: (_, r) => r.confirmed.toLocaleString('th-TH') },
                { title: 'เข้าร่วม', align: 'right', render: (_, r) => r.attended.toLocaleString('th-TH') },
                { title: 'อัตรา', align: 'right', render: (_, r) => (r.attendanceRate == null ? '-' : `${r.attendanceRate}%`) },
              ]}
            />
          </Card>
        </Flex>
      )}
    </QueryState>
  );
}

export function EventReport({ filters }: { filters: ReportFilters }) {
  const can = useCan();
  const msg = useApiMessage();
  const [q, setQ] = useState<{ page: number; perPage: number; sort: string; order: 'asc' | 'desc'; search?: string }>({ page: 1, perPage: 20, sort: 'startAt', order: 'desc' });
  const [search, setSearch] = useState('');
  const params = { ...filters, ...q };
  const list = useQuery({ queryKey: ['report-events', params], queryFn: () => api.getPage<EventReportRow>('/reports/events', params), placeholderData: keepPreviousData });
  const sortOrder = (k: string) => (q.sort === k ? (q.order === 'asc' ? 'ascend' : 'descend') : null);
  return (
    <Card>
      <Flex justify="space-between" gap={12} wrap style={{ marginBottom: 12 }}>
        <Input allowClear prefix={<SearchOutlined />} placeholder="ชื่อ / รหัสกิจกรรม" value={search} onChange={(e) => setSearch(e.target.value)} onPressEnter={() => setQ({ ...q, page: 1, search: search.trim() || undefined })} style={{ width: 280 }} />
        {can('report:export') && (
          <Button icon={<DownloadOutlined />} onClick={() => void downloadFile('/reports/events/export', 'report.xlsx', { ...filters, search: q.search }).catch(msg.error)}>
            ส่งออก Excel
          </Button>
        )}
      </Flex>
      <Table<EventReportRow>
        rowKey="id"
        size="middle"
        loading={list.isFetching}
        dataSource={list.data?.items ?? []}
        scroll={{ x: 1100 }}
        onChange={(p, _f, s) => {
          const sorter = Array.isArray(s) ? s[0] : s;
          setQ({ ...q, page: p.current ?? 1, perPage: p.pageSize ?? 20, sort: sorter?.order ? String(sorter.columnKey) : 'startAt', order: sorter?.order === 'ascend' ? 'asc' : 'desc' });
        }}
        pagination={{ current: q.page, pageSize: q.perPage, total: list.data?.meta.total ?? 0, showSizeChanger: true }}
        columns={[
          {
            title: 'กิจกรรม',
            render: (_, r) => (
              <>
                <Link href={`/admin/events/${r.id}`}>{r.titleTh}</Link>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  {r.code} · {r.organizationName}
                </div>
              </>
            ),
          },
          { title: 'วันที่', key: 'startAt', width: 130, sorter: true, sortOrder: sortOrder('startAt'), render: (_, r) => <ThaiDate value={r.startAt} /> },
          { title: 'สถานะ', width: 130, render: (_, r) => <StatusTag status={r.status} /> },
          { title: 'ลงทะเบียน', key: 'confirmed', width: 110, align: 'right', sorter: true, sortOrder: sortOrder('confirmed'), render: (_, r) => `${r.confirmed}${r.capacity ? `/${r.capacity}` : ''}` },
          { title: 'เข้าร่วม', key: 'attendanceRate', width: 120, align: 'right', sorter: true, sortOrder: sortOrder('attendanceRate'), render: (_, r) => (r.attendanceRate == null ? <Typography.Text type="secondary">{r.attended}</Typography.Text> : `${r.attended} (${r.attendanceRate}%)`) },
          { title: 'รายรับสุทธิ', key: 'revenue', width: 130, align: 'right', sorter: true, sortOrder: sortOrder('revenue'), render: (_, r) => <Money value={(r.collected - r.refunded).toFixed(2)} suffix={false} /> },
          { title: 'ความพึงพอใจ', key: 'satisfaction', width: 120, align: 'right', sorter: true, sortOrder: sortOrder('satisfaction'), render: (_, r) => (r.satisfaction == null ? '-' : `${r.satisfaction.toFixed(2)} (${r.responses})`) },
          { title: 'เกียรติบัตร', width: 100, align: 'right', dataIndex: 'certificates' },
        ]}
      />
    </Card>
  );
}

export function FinanceReportView({ filters }: { filters: ReportFilters }) {
  const q = useQuery({ queryKey: ['report-finance', filters], queryFn: () => api.get<FinanceReport>('/reports/finance', filters), placeholderData: keepPreviousData });
  return (
    <QueryState query={q}>
      {(d) => (
        <Flex vertical gap={16}>
          <Typography.Text type="secondary">ช่วงเวลา: {d.period.label} (ตามวันที่ตรวจรับเงิน / จ่ายคืน)</Typography.Text>
          <Row gutter={[16, 16]}>
            {[
              { title: 'รับโอน (ตรวจแล้ว)', v: d.totals.transfer },
              { title: 'รับเงินสดหน้างาน', v: d.totals.onsite },
              { title: 'คืนเงิน', v: d.totals.refunded },
              { title: 'สุทธิ', v: d.totals.net },
            ].map((t) => (
              <Col key={t.title} xs={12} md={6}>
                <Card size="small">
                  <Statistic title={`${t.title} (บาท)`} value={baht(t.v)} />
                </Card>
              </Col>
            ))}
          </Row>
          <Card title="รายรับรายเดือน (บาท)">
            <ColumnChart
              ariaLabel="รายรับรายเดือนแยกช่องทาง"
              data={d.monthly}
              category="month"
              formatCategory={monthLabel}
              series={[
                { key: 'transfer', label: 'รับโอน' },
                { key: 'onsite', label: 'เงินสดหน้างาน' },
              ]}
            />
          </Card>
          <Card title="รายการค้าง">
            <Row gutter={[16, 16]}>
              <Col xs={12} md={6}><Statistic title="สลิปรอตรวจ" value={d.outstanding.slipsPending} suffix={`รายการ (${baht(d.outstanding.slipsAmount)} บาท)`} valueStyle={{ fontSize: 20 }} /></Col>
              <Col xs={12} md={6}><Statistic title="ใบแจ้งชำระยังไม่ชำระ" value={d.outstanding.ordersUnpaid} suffix={`ใบ (${baht(d.outstanding.unpaidAmount)} บาท)`} valueStyle={{ fontSize: 20 }} /></Col>
              <Col xs={12} md={6}><Statistic title="คำขอคืนเงินค้าง" value={d.outstanding.refundsOpen} valueStyle={{ fontSize: 20 }} /></Col>
            </Row>
          </Card>
        </Flex>
      )}
    </QueryState>
  );
}

export function ParticipantReportView({ filters }: { filters: ReportFilters }) {
  const q = useQuery({ queryKey: ['report-participants', filters], queryFn: () => api.get<ParticipantReport>('/reports/participants', filters), placeholderData: keepPreviousData });
  return (
    <QueryState query={q}>
      {(d) => (
        <Flex vertical gap={16}>
          <Row gutter={[16, 16]}>
            {[
              { title: 'การลงทะเบียน (ยืนยัน)', v: d.totals.registrations },
              { title: 'ผู้เข้าร่วมไม่ซ้ำ', v: d.totals.uniquePeople },
              { title: 'เข้าร่วมมากกว่า 1 กิจกรรม', v: d.totals.repeatPeople },
              { title: 'ผ่านการลงทะเบียนกลุ่ม', v: d.totals.viaGroups },
              { title: 'บุคคลภายนอก (ไม่มีบัญชี)', v: d.totals.guests },
            ].map((t) => (
              <Col key={t.title} xs={12} md={8} xl={4}>
                <Card size="small"><Statistic title={t.title} value={t.v.toLocaleString('th-TH')} /></Card>
              </Col>
            ))}
          </Row>
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={14}>
              <Card title="หน่วยงาน/สถานศึกษาที่ส่งผู้เข้าร่วมมากที่สุด" style={{ height: '100%' }}>
                <BarList valueLabel="ผู้เข้าร่วม (คน)" max={20} items={d.topAffiliations.map((a) => ({ name: a.name, value: a.people, hint: `${a.registrations} ครั้ง` }))} />
              </Card>
            </Col>
            <Col xs={24} lg={10}>
              <Card title="จำนวนกิจกรรมที่แต่ละคนเข้าร่วม" style={{ height: '100%' }}>
                <BarList valueLabel="จำนวนคน" items={d.frequency.map((f) => ({ name: f.events >= 5 ? '5 กิจกรรมขึ้นไป' : `${f.events} กิจกรรม`, value: f.people }))} />
              </Card>
            </Col>
          </Row>
        </Flex>
      )}
    </QueryState>
  );
}
