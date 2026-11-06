'use client';

import { SearchOutlined } from '@ant-design/icons';
import { ApiError } from '@sru/api-client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Col, Input, Row, Select, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { ThaiDate } from '@/components/Format';
import { ErrorState } from '@/components/QueryState';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';
import { ACTION_LABEL, METHOD_LABEL, type CheckinRecordDto, type Location } from './types';

/** Append-only log of every scan / manual check-in / undo, with undo for staff. */
export function CheckinRecords({ eventId, locations }: { eventId: string; locations: Location[] }) {
  const can = useCan();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const { modal } = App.useApp();
  const [q, setQ] = useState<{ page: number; perPage: number; search?: string; locationId?: string }>({ page: 1, perPage: 20 });
  const [search, setSearch] = useState('');
  const list = useQuery({
    queryKey: ['checkin-records', eventId, q],
    queryFn: () => api.getPage<CheckinRecordDto>(`/events/${eventId}/checkin/records`, q),
    placeholderData: keepPreviousData,
  });
  const undo = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/checkin/records/${id}/undo`, { reason }),
    onSuccess: () => {
      msg.success('ยกเลิกรายการแล้ว');
      for (const k of ['checkin-records', 'checkin-stats', 'attendance']) void qc.invalidateQueries({ queryKey: [k, eventId] });
    },
    onError: msg.error,
  });

  const askUndo = (r: CheckinRecordDto) => {
    let reason = '';
    modal.confirm({
      title: `ยกเลิกรายการ${ACTION_LABEL[r.action]?.text}ของ ${r.fullName}?`,
      content: <Input.TextArea autoFocus rows={3} maxLength={500} placeholder="เหตุผล เช่น สแกนผิดคน" onChange={(e) => (reason = e.target.value)} />,
      okText: 'ยืนยัน',
      okButtonProps: { danger: true },
      cancelText: 'ปิด',
      onOk: () => {
        if (reason.trim().length < 3) {
          msg.error(new ApiError(0, 'VALIDATION', 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร'));
          return Promise.reject(new Error('reason'));
        }
        return undo.mutateAsync({ id: r.id, reason: reason.trim() });
      },
    });
  };

  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  return (
    <>
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={10}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="ชื่อ หรือ เลขอ้างอิง"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (!e.target.value) setQ({ ...q, search: undefined, page: 1 });
            }}
            onPressEnter={() => setQ({ ...q, search: search.trim() || undefined, page: 1 })}
          />
        </Col>
        <Col xs={24} md={8}>
          <Select allowClear placeholder="ทุกจุด" style={{ width: '100%' }} value={q.locationId} onChange={(locationId) => setQ({ ...q, locationId, page: 1 })} options={locations.map((l) => ({ value: l.id, label: l.nameTh }))} />
        </Col>
      </Row>
      <Table<CheckinRecordDto>
        rowKey="id"
        size="small"
        loading={list.isFetching}
        dataSource={list.data?.items}
        scroll={{ x: 1000 }}
        pagination={{ current: q.page, pageSize: q.perPage, total: list.data?.meta.total, showTotal: (t) => `ทั้งหมด ${t} รายการ`, onChange: (page, perPage) => setQ({ ...q, page, perPage }) }}
        columns={[
          { title: 'เวลา', dataIndex: 'occurredAt', width: 170, render: (d, r) => <span title={r.method === 'OFFLINE' ? `ส่งเข้าระบบเมื่อ ${new Date(r.createdAt).toLocaleString('th-TH')}` : undefined}><ThaiDate value={d} time /></span> },
          { title: 'เลขอ้างอิง', dataIndex: 'referenceNo', width: 160, render: (v) => <Typography.Text code>{v}</Typography.Text> },
          { title: 'ชื่อ', dataIndex: 'fullName', render: (n, r) => (r.undone ? <Typography.Text delete>{n}</Typography.Text> : n) },
          { title: 'รายการ', dataIndex: 'action', width: 130, render: (a, r) => (
            <>
              <Tag color={ACTION_LABEL[a]?.color}>{ACTION_LABEL[a]?.text}</Tag>
              {r.undone && <Tag>ถูกยกเลิก</Tag>}
            </>
          ) },
          { title: 'วิธี', dataIndex: 'method', width: 100, render: (m) => METHOD_LABEL[m] },
          { title: 'จุด / ช่วง', render: (_, r) => [r.location, r.schedule].filter(Boolean).join(' · ') || '-' },
          { title: 'เจ้าหน้าที่', dataIndex: 'actor', width: 160, render: (a) => a ?? '-' },
          { title: 'หมายเหตุ', render: (_, r) => r.undone?.reason ?? r.note ?? '' },
          {
            title: '',
            width: 90,
            render: (_, r) =>
              can('checkin:update') && r.action !== 'UNDO' && !r.undone && (
                <Button size="small" danger type="link" onClick={() => askUndo(r)}>
                  ยกเลิก
                </Button>
              ),
          },
        ]}
      />
    </>
  );
}
