'use client';

import { SearchOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Card, Col, DatePicker, Empty, Input, Pagination, Row, Segmented, Select, Skeleton } from 'antd';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { ErrorState } from '@/components/QueryState';
import { api } from '@/services/api';
import dayjs, { DATE_FMT } from '@/services/dayjs';
import { EventCard } from './EventCard';

const TABS = [
  { label: 'ทั้งหมด', value: 'all' },
  { label: 'เปิดรับสมัคร', value: 'open' },
  { label: 'กำลังจะจัด', value: 'upcoming' },
  { label: 'ย้อนหลัง', value: 'past' },
];

/** Filters live in the URL so results can be shared / bookmarked. */
export function EventBrowser() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(params.get('search') ?? '');

  const set = useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
      if (!('page' in patch)) next.delete('page');
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const q = {
    tab: params.get('tab') ?? 'all',
    search: params.get('search') ?? undefined,
    categoryId: params.get('categoryId') ?? undefined,
    eventTypeId: params.get('eventTypeId') ?? undefined,
    organizationId: params.get('organizationId') ?? undefined,
    isPaid: params.get('isPaid') ?? undefined,
    featured: params.get('featured') ?? undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    page: Number(params.get('page') ?? 1),
    perPage: 12,
  };

  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.public.lookups(), staleTime: 10 * 60_000 });
  const orgs = useQuery({ queryKey: ['orgs-public'], queryFn: () => api.public.organizations(), staleTime: 10 * 60_000 });
  const events = useQuery({ queryKey: ['public-events', q], queryFn: () => api.public.events(q), placeholderData: keepPreviousData });

  return (
    <>
      <Card style={{ marginBottom: 20 }}>
        <Row gutter={[12, 12]}>
          <Col xs={24}>
            <Segmented options={TABS} value={q.tab} onChange={(v) => set({ tab: v === 'all' ? undefined : String(v) })} />
          </Col>
          <Col xs={24} md={8}>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="ค้นหาชื่อกิจกรรม รหัส หรือแท็ก"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (!e.target.value) set({ search: undefined });
              }}
              onPressEnter={() => set({ search: search.trim() || undefined })}
              aria-label="ค้นหากิจกรรม"
            />
          </Col>
          <Col xs={12} md={4}>
            <Select
              allowClear
              style={{ width: '100%' }}
              placeholder="หมวดหมู่"
              value={q.categoryId}
              onChange={(v) => set({ categoryId: v })}
              options={lookups.data?.categories.map((c) => ({ value: c.id, label: c.nameTh }))}
            />
          </Col>
          <Col xs={12} md={4}>
            <Select
              allowClear
              style={{ width: '100%' }}
              placeholder="ประเภท"
              value={q.eventTypeId}
              onChange={(v) => set({ eventTypeId: v })}
              options={lookups.data?.eventTypes.map((c) => ({ value: c.id, label: c.nameTh }))}
            />
          </Col>
          <Col xs={12} md={4}>
            <Select
              allowClear
              showSearch={{ optionFilterProp: 'label' }}
              style={{ width: '100%' }}
              placeholder="หน่วยงาน"
              value={q.organizationId}
              onChange={(v) => set({ organizationId: v })}
              options={orgs.data?.map((o) => ({ value: o.id, label: o.nameTh }))}
            />
          </Col>
          <Col xs={12} md={4}>
            <Select
              allowClear
              style={{ width: '100%' }}
              placeholder="ค่าใช้จ่าย"
              value={q.isPaid}
              onChange={(v) => set({ isPaid: v })}
              options={[
                { value: 'false', label: 'ไม่มีค่าใช้จ่าย' },
                { value: 'true', label: 'มีค่าลงทะเบียน' },
              ]}
            />
          </Col>
          <Col xs={24} md={8}>
            <DatePicker.RangePicker
              style={{ width: '100%' }}
              format={DATE_FMT}
              placeholder={['ตั้งแต่วันที่', 'ถึงวันที่']}
              value={q.from && q.to ? [dayjs(q.from), dayjs(q.to)] : null}
              onChange={(r) =>
                set({ from: r?.[0]?.startOf('day').toISOString(), to: r?.[1]?.endOf('day').toISOString() })
              }
            />
          </Col>
        </Row>
      </Card>

      {events.isPending ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : events.isError ? (
        <ErrorState error={events.error} onRetry={() => events.refetch()} />
      ) : events.data.items.length === 0 ? (
        <Empty description="ไม่พบกิจกรรมตามเงื่อนไขที่เลือก" style={{ padding: 48 }} />
      ) : (
        <>
          <Row gutter={[16, 16]} style={{ opacity: events.isPlaceholderData ? 0.6 : 1 }}>
            {events.data.items.map((e) => (
              <Col key={e.id} xs={24} sm={12} lg={8}>
                <EventCard event={e} />
              </Col>
            ))}
          </Row>
          <Pagination
            style={{ marginTop: 24, justifyContent: 'center' }}
            current={q.page}
            pageSize={q.perPage}
            total={events.data.meta.total}
            showSizeChanger={false}
            onChange={(p) => set({ page: String(p) })}
            showTotal={(t) => `ทั้งหมด ${t.toLocaleString('th-TH')} กิจกรรม`}
          />
        </>
      )}
    </>
  );
}
