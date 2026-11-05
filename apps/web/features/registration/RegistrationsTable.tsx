'use client';

import { DownloadOutlined, SearchOutlined } from '@ant-design/icons';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Col, Dropdown, Input, Popconfirm, Row, Select, Statistic, Table, Typography } from 'antd';
import { useState } from 'react';
import type { RegistrationDto } from '@sru/shared-types';
import { STATUS_META } from '@sru/shared-types';
import { ThaiDate } from '@/components/Format';
import { ErrorState } from '@/components/QueryState';
import { StatusTag } from '@/components/StatusTag';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';

const REG_STATUSES = ['CONFIRMED', 'PENDING_PAYMENT', 'WAITLISTED', 'CANCELLED', 'EXPIRED'];

async function download(eventId: string, format: 'xlsx' | 'csv', status?: string) {
  const res = await api.http.get(`/events/${eventId}/registrations/export`, { params: { format, status }, responseType: 'blob' });
  const name = /filename="([^"]+)"/.exec(String(res.headers['content-disposition'] ?? ''))?.[1] ?? `registrations.${format}`;
  const url = URL.createObjectURL(res.data as Blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export function RegistrationsTable({ eventId }: { eventId: string }) {
  const can = useCan();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const [q, setQ] = useState<{ page: number; perPage: number; status?: string; search?: string }>({ page: 1, perPage: 20 });
  const [search, setSearch] = useState('');
  const list = useQuery({
    queryKey: ['registrations', eventId, q],
    queryFn: () => api.getPage<RegistrationDto>(`/events/${eventId}/registrations`, q),
    placeholderData: keepPreviousData,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post<{ promotedFromWaitlist: number }>(`/registrations/${id}/cancel`, { reason: 'ยกเลิกโดยผู้จัดกิจกรรม' }),
    onSuccess: (r) => {
      msg.success(r.promotedFromWaitlist ? `ยกเลิกแล้ว และเลื่อนผู้สำรอง ${r.promotedFromWaitlist} คน` : 'ยกเลิกแล้ว');
      void qc.invalidateQueries({ queryKey: ['registrations', eventId] });
      void qc.invalidateQueries({ queryKey: ['admin-event', eventId] });
    },
    onError: msg.error,
  });
  const counts = list.data?.meta.statusCounts ?? {};

  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  return (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {['CONFIRMED', 'WAITLISTED', 'PENDING_PAYMENT', 'CANCELLED'].map((s) => (
          <Col key={s} xs={12} md={6}>
            <Statistic title={STATUS_META[s]?.label} value={counts[s] ?? 0} />
          </Col>
        ))}
      </Row>
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={10}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="ค้นหาชื่อ อีเมล เลขอ้างอิง รหัสนักศึกษา"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (!e.target.value) setQ({ ...q, search: undefined, page: 1 });
            }}
            onPressEnter={() => setQ({ ...q, search: search.trim() || undefined, page: 1 })}
          />
        </Col>
        <Col xs={12} md={6}>
          <Select allowClear placeholder="สถานะ" style={{ width: '100%' }} value={q.status} onChange={(status) => setQ({ ...q, status, page: 1 })} options={REG_STATUSES.map((s) => ({ value: s, label: STATUS_META[s]?.label }))} />
        </Col>
        <Col xs={12} md={8} style={{ textAlign: 'right' }}>
          {can('registration:export') && (
            <Dropdown
              menu={{
                items: [
                  { key: 'xlsx', label: 'Excel (.xlsx)' },
                  { key: 'csv', label: 'CSV' },
                ],
                onClick: ({ key }) => download(eventId, key as 'xlsx' | 'csv', q.status).catch(msg.error),
              }}
            >
              <Button icon={<DownloadOutlined />}>ส่งออกรายชื่อ</Button>
            </Dropdown>
          )}
        </Col>
      </Row>
      <Table<RegistrationDto>
        rowKey="id"
        loading={list.isFetching}
        dataSource={list.data?.items}
        scroll={{ x: 900 }}
        locale={{ emptyText: 'ยังไม่มีผู้ลงทะเบียน' }}
        pagination={{ current: q.page, pageSize: q.perPage, total: list.data?.meta.total, showTotal: (t) => `ทั้งหมด ${t} รายการ`, onChange: (page, perPage) => setQ({ ...q, page, perPage }) }}
        columns={[
          { title: 'เลขอ้างอิง', dataIndex: 'referenceNo', width: 160, render: (r) => <Typography.Text code>{r}</Typography.Text> },
          { title: 'ชื่อ-นามสกุล', dataIndex: 'fullName' },
          { title: 'อีเมล', dataIndex: 'email', ellipsis: true },
          { title: 'โทรศัพท์', dataIndex: 'phone', width: 120, render: (p) => p ?? '-' },
          { title: 'วันที่ลงทะเบียน', dataIndex: 'createdAt', width: 180, render: (d) => <ThaiDate value={d} time /> },
          { title: 'สถานะ', dataIndex: 'status', width: 130, render: (s) => <StatusTag status={s} /> },
          {
            title: '',
            width: 90,
            render: (_, r) =>
              can('registration:update') &&
              ['CONFIRMED', 'WAITLISTED', 'PENDING_PAYMENT'].includes(r.status) && (
                <Popconfirm title="ยกเลิกการลงทะเบียนนี้?" description="ที่นั่งจะถูกส่งต่อให้ผู้อยู่ในรายชื่อสำรอง" okText="ยืนยัน" cancelText="ไม่" okButtonProps={{ danger: true }} onConfirm={() => cancel.mutate(r.id)}>
                  <Button size="small" danger type="link">
                    ยกเลิก
                  </Button>
                </Popconfirm>
              ),
          },
        ]}
      />
    </>
  );
}
