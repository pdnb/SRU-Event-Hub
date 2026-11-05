'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Card, DatePicker, Flex, Input, Select, Table, Tag, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { useState } from 'react';
import { ThaiDate } from '@/components/Format';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/QueryState';
import { api } from '@/services/api';
import { DATE_FMT } from '@/services/dayjs';

interface AuditRow {
  id: string;
  actorId: string | null;
  actorName: string | null;
  actorIp: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  requestId: string | null;
  createdAt: string;
}

const Json = ({ value }: { value: unknown }) =>
  value == null ? (
    <Typography.Text type="secondary">-</Typography.Text>
  ) : (
    <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 280, overflow: 'auto' }}>{JSON.stringify(value, null, 2)}</pre>
  );

/** Read-only audit trail (append-only in the DB). Filter by action prefix, entity, or date range. */
export default function AuditLogsPage() {
  const [action, setAction] = useState<string>();
  const [entityType, setEntityType] = useState('');
  const [search, setSearch] = useState('');
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [page, setPage] = useState(1);

  const actions = useQuery({ queryKey: ['audit-actions'], queryFn: () => api.get<string[]>('/audit-logs/actions'), staleTime: 300_000 });
  const list = useQuery({
    queryKey: ['audit-logs', action, entityType, search, range?.[0]?.toISOString(), range?.[1]?.toISOString(), page],
    queryFn: () =>
      api.getPage<AuditRow>('/audit-logs', {
        action,
        entityType: entityType || undefined,
        search: search || undefined,
        from: range?.[0]?.startOf('day').toISOString(),
        to: range?.[1]?.endOf('day').toISOString(),
        page,
        perPage: 50,
      }),
    placeholderData: keepPreviousData,
  });
  const reset = () => setPage(1);

  return (
    <>
      <PageHeader title="Audit Log" description="ประวัติการกระทำสำคัญทั้งหมดในระบบ (แก้ไขหรือลบไม่ได้) — ใช้ตรวจสอบย้อนหลังและสืบค้นเหตุการณ์" breadcrumb={[{ title: 'Audit Log' }]} />
      <Card>
        <Flex gap={12} wrap style={{ marginBottom: 12 }}>
          <Select
            allowClear
            showSearch
            style={{ minWidth: 240 }}
            placeholder="การกระทำ (เช่น payment.verify)"
            value={action}
            onChange={(v) => { setAction(v); reset(); }}
            options={[
              ...[...new Set((actions.data ?? []).map((a) => `${a.split('.')[0]}.`))].map((p) => ({ value: p, label: `${p}* (ทั้งหมด)` })),
              ...(actions.data ?? []).map((a) => ({ value: a, label: a })),
            ]}
          />
          <Input allowClear placeholder="ชนิดข้อมูล (เช่น payment, event)" style={{ width: 220 }} value={entityType} onChange={(e) => { setEntityType(e.target.value.trim()); reset(); }} />
          <Input.Search allowClear placeholder="รหัสข้อมูล / Request ID / ข้อความในเหตุผล" style={{ width: 320 }} onSearch={(v) => { setSearch(v.trim()); reset(); }} />
          <DatePicker.RangePicker format={DATE_FMT} value={range} onChange={(v) => { setRange(v); reset(); }} />
        </Flex>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : (
          <Table<AuditRow>
            rowKey="id"
            size="small"
            loading={list.isFetching}
            dataSource={list.data?.items}
            scroll={{ x: 900 }}
            pagination={{ current: page, pageSize: 50, total: list.data?.meta.total, onChange: setPage, showSizeChanger: false }}
            expandable={{
              expandedRowRender: (r) => (
                <Flex gap={16} wrap>
                  <div style={{ flex: '1 1 300px' }}><Typography.Text strong>ก่อน</Typography.Text><Json value={r.before} /></div>
                  <div style={{ flex: '1 1 300px' }}><Typography.Text strong>หลัง</Typography.Text><Json value={r.after} /></div>
                  <div style={{ flex: '1 1 100%' }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      IP {r.actorIp ?? '-'} · Request {r.requestId ?? '-'} · {r.entityType}/{r.entityId ?? '-'}
                    </Typography.Text>
                  </div>
                </Flex>
              ),
            }}
            columns={[
              { title: 'วันเวลา', dataIndex: 'createdAt', width: 170, render: (v: string) => <ThaiDate value={v} time /> },
              { title: 'ผู้กระทำ', dataIndex: 'actorName', width: 200, render: (v: string | null) => v ?? '-' },
              { title: 'การกระทำ', dataIndex: 'action', width: 220, render: (v: string) => <Tag>{v}</Tag> },
              { title: 'ข้อมูล', render: (_, r) => <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.entityType} · {r.entityId?.slice(0, 18) ?? '-'}</Typography.Text> },
              { title: 'เหตุผล', dataIndex: 'reason', render: (v: string | null) => v ?? '' },
            ]}
          />
        )}
      </Card>
    </>
  );
}
