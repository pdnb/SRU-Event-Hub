'use client';

import { SearchOutlined } from '@ant-design/icons';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ParticipantOrganizationDto } from '@sru/shared-types';
import { Button, Card, Input, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { ThaiDate } from '@/components/Format';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/QueryState';
import { orgTypeLabel } from '@/features/groups/ParticipantOrgForm';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';

/** Organizations that send participants (external), with verification by organizers. */
export default function ParticipantOrgsPage() {
  const can = useCan();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const [q, setQ] = useState<{ page: number; perPage: number; search?: string; verified?: boolean }>({ page: 1, perPage: 20 });
  const [search, setSearch] = useState('');
  const list = useQuery({ queryKey: ['participant-orgs', q], queryFn: () => api.getPage<ParticipantOrganizationDto>('/participant-orgs', q), placeholderData: keepPreviousData });
  const verify = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => api.post(`/participant-orgs/${id}/${on ? 'verify' : 'unverify'}`),
    onSuccess: () => {
      msg.success('บันทึกแล้ว');
      void qc.invalidateQueries({ queryKey: ['participant-orgs'] });
    },
    onError: msg.error,
  });

  return (
    <>
      <PageHeader title="องค์กรผู้ส่งเข้าร่วม" description="โรงเรียน หน่วยงาน และองค์กรภายนอกที่ลงทะเบียนแบบกลุ่ม — ตรวจสอบข้อมูลก่อนออกใบเสร็จในนามองค์กร" breadcrumb={[{ title: 'การลงทะเบียน' }, { title: 'องค์กรผู้ส่งเข้าร่วม' }]} />
      <Card>
        <Space wrap style={{ marginBottom: 12 }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="ชื่อองค์กร หรือเลขผู้เสียภาษี"
            style={{ width: 300 }}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (!e.target.value) setQ({ ...q, search: undefined, page: 1 });
            }}
            onPressEnter={() => setQ({ ...q, search: search.trim() || undefined, page: 1 })}
          />
          <Select
            allowClear
            placeholder="สถานะการตรวจสอบ"
            style={{ width: 200 }}
            value={q.verified === undefined ? undefined : String(q.verified)}
            onChange={(v) => setQ({ ...q, verified: v === undefined ? undefined : v === 'true', page: 1 })}
            options={[
              { value: 'false', label: 'ยังไม่ตรวจสอบ' },
              { value: 'true', label: 'ตรวจสอบแล้ว' },
            ]}
          />
        </Space>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : (
          <Table<ParticipantOrganizationDto>
            rowKey="id"
            size="small"
            loading={list.isFetching}
            dataSource={list.data?.items}
            scroll={{ x: 1000 }}
            pagination={{ current: q.page, pageSize: q.perPage, total: list.data?.meta.total, onChange: (page, perPage) => setQ({ ...q, page, perPage }) }}
            columns={[
              { title: 'ชื่อองค์กร', render: (_, o) => <>{o.nameTh}<div><Typography.Text type="secondary" style={{ fontSize: 13 }}>{orgTypeLabel(o.orgType)}{o.province ? ` · ${o.province}` : ''}</Typography.Text></div></> },
              { title: 'เลขผู้เสียภาษี', dataIndex: 'taxId', width: 160, render: (v, o) => (v ? `${v} (${o.branch ?? '00000'})` : '-') },
              { title: 'ติดต่อ', render: (_, o) => [o.phone, o.email].filter(Boolean).join(' · ') || '-' },
              { title: 'ผู้ประสานงาน', render: (_, o) => o.coordinators.map((c) => `${c.displayName} (${c.email})`).join(', ') },
              { title: 'สร้างเมื่อ', dataIndex: 'createdAt', width: 130, render: (d) => <ThaiDate value={d} /> },
              {
                title: 'การตรวจสอบ',
                width: 170,
                render: (_, o) => (
                  <Space>
                    {o.verified ? <Tag color="blue">ตรวจสอบแล้ว</Tag> : <Tag>ยังไม่ตรวจสอบ</Tag>}
                    {can('participant_org:approve') && (
                      <Popconfirm title={o.verified ? 'ยกเลิกสถานะตรวจสอบแล้ว?' : 'ยืนยันว่าตรวจสอบข้อมูลองค์กรนี้แล้ว?'} okText="ยืนยัน" cancelText="ไม่" onConfirm={() => verify.mutate({ id: o.id, on: !o.verified })}>
                        <Button size="small" type="link">
                          {o.verified ? 'ยกเลิก' : 'ตรวจสอบ'}
                        </Button>
                      </Popconfirm>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>
    </>
  );
}
