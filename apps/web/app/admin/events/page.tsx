'use client';

import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, Card, Col, Input, Row, Select, Table, Typography } from 'antd';
import Link from 'next/link';
import { useState } from 'react';
import type { EventSummaryDto } from '@sru/shared-types';
import { STATUS_META } from '@sru/shared-types';
import { ThaiDateRange } from '@/components/Format';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/QueryState';
import { StatusTag } from '@/components/StatusTag';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';

const EVENT_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

export default function AdminEventsPage() {
  const can = useCan();
  const [q, setQ] = useState<{ page: number; perPage: number; search?: string; status?: string; organizationId?: string }>({ page: 1, perPage: 20 });
  const [search, setSearch] = useState('');
  const orgs = useQuery({ queryKey: ['orgs-public'], queryFn: () => api.public.organizations(), staleTime: 600_000 });
  const list = useQuery({ queryKey: ['admin-events', q], queryFn: () => api.getPage<EventSummaryDto>('/events', q), placeholderData: keepPreviousData });

  return (
    <>
      <PageHeader
        title="จัดการกิจกรรม"
        description="กิจกรรมทั้งหมดในขอบเขตหน่วยงานที่ท่านรับผิดชอบ"
        breadcrumb={[{ title: 'จัดการกิจกรรม' }]}
        actions={
          can('event:create') && (
            <Link href="/admin/events/new">
              <Button type="primary" icon={<PlusOutlined />}>
                สร้างกิจกรรม
              </Button>
            </Link>
          )
        }
      />
      <Card>
        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
          <Col xs={24} md={10}>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="ค้นหาชื่อ / รหัสกิจกรรม"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (!e.target.value) setQ({ ...q, search: undefined, page: 1 });
              }}
              onPressEnter={() => setQ({ ...q, search: search.trim() || undefined, page: 1 })}
            />
          </Col>
          <Col xs={12} md={6}>
            <Select allowClear placeholder="สถานะ" style={{ width: '100%' }} value={q.status} onChange={(status) => setQ({ ...q, status, page: 1 })} options={EVENT_STATUSES.map((s) => ({ value: s, label: STATUS_META[s]?.label ?? s }))} />
          </Col>
          <Col xs={12} md={8}>
            <Select allowClear showSearch={{ optionFilterProp: 'label' }} placeholder="หน่วยงาน" style={{ width: '100%' }} value={q.organizationId} onChange={(organizationId) => setQ({ ...q, organizationId, page: 1 })} options={orgs.data?.map((o) => ({ value: o.id, label: o.nameTh }))} />
          </Col>
        </Row>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : (
          <Table<EventSummaryDto>
            rowKey="id"
            loading={list.isFetching}
            dataSource={list.data?.items}
            scroll={{ x: 900 }}
            locale={{ emptyText: 'ไม่พบกิจกรรม' }}
            pagination={{
              current: q.page,
              pageSize: q.perPage,
              total: list.data?.meta.total,
              showSizeChanger: true,
              showTotal: (t) => `ทั้งหมด ${t} รายการ`,
              onChange: (page, perPage) => setQ({ ...q, page, perPage }),
            }}
            columns={[
              { title: 'รหัส', dataIndex: 'code', width: 150, render: (c) => <Typography.Text code>{c}</Typography.Text> },
              { title: 'ชื่อกิจกรรม', dataIndex: 'titleTh', render: (t, r) => <Link href={`/admin/events/${r.id}`}>{t}</Link> },
              { title: 'หน่วยงาน', dataIndex: 'organizationName', width: 200 },
              { title: 'วันที่จัด', width: 230, render: (_, r) => <ThaiDateRange start={r.startAt} end={r.endAt} /> },
              { title: 'ผู้สมัคร', width: 110, align: 'right', render: (_, r) => `${r.seatsTaken.toLocaleString('th-TH')}${r.capacity ? ` / ${r.capacity.toLocaleString('th-TH')}` : ''}` },
              { title: 'สถานะ', dataIndex: 'status', width: 140, render: (s) => <StatusTag status={s} /> },
            ]}
          />
        )}
      </Card>
    </>
  );
}
