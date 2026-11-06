'use client';

import { SearchOutlined } from '@ant-design/icons';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EventGroupSettingDto, GroupSummaryDto } from '@sru/shared-types';
import { Button, Card, Col, DatePicker, Form, Input, InputNumber, Row, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import Link from 'next/link';
import { useState } from 'react';
import type { Page } from '@sru/api-client';
import { Money, ThaiDate } from '@/components/Format';
import { ErrorState } from '@/components/QueryState';
import { StatusTag } from '@/components/StatusTag';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';
import dayjs, { DATETIME_FMT } from '@/services/dayjs';
import { GroupStatusTag } from './GroupWorkspace';

type SettingValues = Omit<EventGroupSettingDto, 'eventId' | 'memberChangeCloseAt'> & { memberChangeCloseAt: Dayjs | null };

/** Admin event page tab: group-registration rules + the groups registered for the event. */
export function EventGroupsTab({ eventId, startAt, capacity }: { eventId: string; startAt: string; capacity: number | null }) {
  const can = useCan();
  return (
    <>
      <GroupSettingsCard eventId={eventId} startAt={startAt} capacity={capacity} editable={can('group:update')} />
      <Card title="กลุ่มที่ลงทะเบียน" style={{ marginTop: 16 }}>
        <GroupsTable eventId={eventId} />
      </Card>
    </>
  );
}

function GroupSettingsCard({ eventId, startAt, capacity, editable }: { eventId: string; startAt: string; capacity: number | null; editable: boolean }) {
  const qc = useQueryClient();
  const msg = useApiMessage();
  const [form] = Form.useForm<SettingValues>();
  const settings = useQuery({ queryKey: ['group-settings', eventId], queryFn: () => api.get<EventGroupSettingDto>(`/public/events/${eventId}/group-settings`) });
  const save = useMutation({
    mutationFn: (v: SettingValues) =>
      api.put<EventGroupSettingDto>(`/events/${eventId}/group-settings`, {
        ...v,
        maxGroupsPerOrganization: v.maxGroupsPerOrganization || null,
        memberChangeCloseAt: v.memberChangeCloseAt ? v.memberChangeCloseAt.toISOString() : null,
      }),
    onSuccess: () => {
      msg.success('บันทึกการตั้งค่าแล้ว');
      void qc.invalidateQueries({ queryKey: ['group-settings', eventId] });
    },
    onError: msg.error,
  });
  const s = settings.data;
  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => settings.refetch()} />;
  if (!s) return <Card loading />;

  return (
    <Card title="ตั้งค่าการลงทะเบียนแบบกลุ่ม">
      <Form
        form={form}
        layout="vertical"
        disabled={!editable}
        initialValues={{ ...s, memberChangeCloseAt: s.memberChangeCloseAt ? dayjs(s.memberChangeCloseAt) : null }}
        onFinish={(v) => save.mutate(v)}
      >
        <Form.Item name="isEnabled" label="เปิดรับการลงทะเบียนแบบกลุ่ม" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Row gutter={16}>
          <Col xs={12} md={6}>
            <Form.Item name="minMembers" label="สมาชิกขั้นต่ำ (คน)" rules={[{ required: true }]}>
              <InputNumber min={1} max={capacity ?? 1000} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item
              name="maxMembers"
              label="สมาชิกสูงสุด (คน)"
              dependencies={['minMembers']}
              rules={[{ required: true }, ({ getFieldValue }) => ({ validator: (_, v) => (v >= getFieldValue('minMembers') ? Promise.resolve() : Promise.reject(new Error('ต้องไม่น้อยกว่าขั้นต่ำ'))) })]}
            >
              <InputNumber min={1} max={1000} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={6}>
            <Form.Item name="maxGroupsPerOrganization" label="จำนวนกลุ่มต่อองค์กร" extra="เว้นว่าง = ไม่จำกัด">
              <InputNumber min={1} max={1000} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={6}>
            <Form.Item name="memberChangeCloseAt" label="ปิดแก้ไขรายชื่อ" extra="เว้นว่าง = เวลาเริ่มกิจกรรม">
              <DatePicker showTime={{ format: 'HH:mm' }} format={DATETIME_FMT} style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(startAt))} />
            </Form.Item>
          </Col>
        </Row>
        <Space size={32} wrap>
          <Form.Item name="allowImport" label="นำเข้ารายชื่อจาก Excel" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="allowInviteLinks" label="ลิงก์เชิญให้สมาชิกกรอกเอง" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Space>
        {editable && (
          <div>
            <Button type="primary" htmlType="submit" loading={save.isPending}>
              บันทึกการตั้งค่า
            </Button>
          </div>
        )}
      </Form>
    </Card>
  );
}

const GROUP_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'DRAFT'];

function GroupsTable({ eventId }: { eventId: string }) {
  const [q, setQ] = useState<{ page: number; perPage: number; status?: string; search?: string }>({ page: 1, perPage: 20 });
  const [search, setSearch] = useState('');
  const list = useQuery({
    queryKey: ['event-groups', eventId, q],
    queryFn: () => api.getPage<GroupSummaryDto>(`/events/${eventId}/groups`, q) as Promise<Page<GroupSummaryDto>>,
    placeholderData: keepPreviousData,
  });
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  const counts = list.data?.meta.statusCounts ?? {};
  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="เลขที่กลุ่ม ชื่อกลุ่ม หรือองค์กร"
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
          placeholder="สถานะ (ไม่รวมฉบับร่าง)"
          style={{ width: 240 }}
          value={q.status}
          onChange={(status) => setQ({ ...q, status, page: 1 })}
          options={GROUP_STATUSES.map((s) => ({ value: s, label: <><GroupStatusTag status={s} /> {counts[s] ?? 0}</> }))}
        />
      </Space>
      <Table<GroupSummaryDto>
        rowKey="id"
        size="small"
        loading={list.isFetching}
        dataSource={list.data?.items}
        scroll={{ x: 980 }}
        locale={{ emptyText: 'ยังไม่มีกลุ่ม' }}
        pagination={{ current: q.page, pageSize: q.perPage, total: list.data?.meta.total, onChange: (page, perPage) => setQ({ ...q, page, perPage }) }}
        columns={[
          { title: 'เลขที่กลุ่ม', dataIndex: 'groupNo', width: 160, render: (v, g) => <Link href={`/admin/groups/${g.id}`}>{v}</Link> },
          { title: 'ชื่อกลุ่ม', dataIndex: 'name' },
          { title: 'องค์กร', render: (_, g) => <>{g.participantOrganization.nameTh} {g.participantOrganization.verified && <Tag color="blue">ตรวจสอบแล้ว</Tag>}</> },
          { title: 'ผู้ประสานงาน', render: (_, g) => <>{g.coordinator.displayName}<div><Typography.Text type="secondary" style={{ fontSize: 13 }}>{g.contactPhone ?? g.coordinator.email}</Typography.Text></div></> },
          { title: 'สมาชิก', dataIndex: 'memberCount', width: 80, align: 'right' },
          { title: 'ยอดชำระ', width: 150, render: (_, g) => (g.payment ? <Space size={4} direction="vertical"><Money value={g.payment.amount} /><StatusTag status={g.payment.status} /></Space> : '-') },
          { title: 'ส่งเมื่อ', dataIndex: 'submittedAt', width: 160, render: (d) => <ThaiDate value={d} time /> },
          { title: 'สถานะ', dataIndex: 'status', width: 150, render: (s) => <GroupStatusTag status={s} /> },
        ]}
      />
    </>
  );
}
