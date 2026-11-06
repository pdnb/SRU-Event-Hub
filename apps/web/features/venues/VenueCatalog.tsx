'use client';

import { EditOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, Col, Flex, Form, Input, InputNumber, Modal, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { ErrorState } from '@/components/QueryState';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';
import { VENUE_TYPE_LABEL, type Building, type Resource, type Venue } from './types';

const useOrgs = () => useQuery({ queryKey: ['orgs-public'], queryFn: () => api.public.organizations(), staleTime: 10 * 60_000 });
const useBuildings = () => useQuery({ queryKey: ['buildings'], queryFn: () => api.get<Building[]>('/buildings'), staleTime: 60_000 });
const canManage = (can: ReturnType<typeof useCan>) => can('venue:create') || can('venue:update');

/** Rooms: managing unit decides who approves; auto-approve for self-service rooms. */
export function VenueCatalog() {
  const can = useCan();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const orgs = useOrgs();
  const buildings = useBuildings();
  const [q, setQ] = useState<{ page: number; perPage: number; search?: string; includeInactive: 'true' | 'false' }>({ page: 1, perPage: 20, includeInactive: 'true' });
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Venue | 'new' | null>(null);
  const [form] = Form.useForm();
  const list = useQuery({ queryKey: ['venues', q], queryFn: () => api.getPage<Venue>('/venues', q), placeholderData: keepPreviousData });
  const save = useMutation({
    mutationFn: (v: Record<string, unknown>) => (editing === 'new' ? api.post('/venues', v) : api.patch(`/venues/${(editing as Venue).id}`, v)),
    onSuccess: () => {
      msg.success('บันทึกแล้ว');
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['venues'] });
      void qc.invalidateQueries({ queryKey: ['venue-availability'] });
    },
    onError: msg.error,
  });
  const open = (v: Venue | 'new') => {
    form.resetFields();
    form.setFieldsValue(v === 'new' ? { venueType: 'MEETING_ROOM', isActive: true, autoApprove: false } : { ...v });
    setEditing(v);
  };

  return (
    <>
      <Flex justify="space-between" gap={12} wrap style={{ marginBottom: 12 }}>
        <Input allowClear prefix={<SearchOutlined />} placeholder="ชื่อ / รหัส" value={search} onChange={(e) => setSearch(e.target.value)} onPressEnter={() => setQ({ ...q, page: 1, search: search.trim() || undefined })} style={{ width: 260 }} />
        {canManage(can) && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
            เพิ่มสถานที่
          </Button>
        )}
      </Flex>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <Table<Venue>
          rowKey="id"
          size="middle"
          loading={list.isFetching}
          dataSource={list.data?.items ?? []}
          scroll={{ x: 900 }}
          pagination={{ current: q.page, pageSize: q.perPage, total: list.data?.meta.total ?? 0, onChange: (page, perPage) => setQ({ ...q, page, perPage }) }}
          columns={[
            { title: 'รหัส', dataIndex: 'code', width: 120 },
            { title: 'ชื่อ', render: (_, v) => (<><div>{v.nameTh}</div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{[v.building?.nameTh, v.floor ? `ชั้น ${v.floor}` : null].filter(Boolean).join(' · ')}</Typography.Text></>) },
            { title: 'ประเภท', width: 130, render: (_, v) => VENUE_TYPE_LABEL[v.venueType] },
            { title: 'ที่นั่ง', width: 80, render: (_, v) => v.capacity ?? '-' },
            { title: 'ผู้ดูแล/อนุมัติ', width: 220, render: (_, v) => (<>{v.organization?.nameTh ?? <Tag>ส่วนกลาง</Tag>}{v.autoApprove && <div><Tag color="blue">อนุมัติอัตโนมัติ</Tag></div>}</>) },
            { title: 'สถานะ', width: 90, render: (_, v) => (v.isActive ? <Tag color="green">ใช้งาน</Tag> : <Tag>ปิด</Tag>) },
            { title: '', width: 60, render: (_, v) => canManage(can) && <Button size="small" icon={<EditOutlined />} aria-label="แก้ไข" onClick={() => open(v)} /> },
          ]}
        />
      )}
      <Modal open={!!editing} title={editing === 'new' ? 'เพิ่มสถานที่' : 'แก้ไขสถานที่'} okText="บันทึก" cancelText="ยกเลิก" onCancel={() => setEditing(null)} onOk={() => form.submit()} okButtonProps={{ loading: save.isPending }} width={680} forceRender>
        <Form
          form={form}
          layout="vertical"
          onFinish={(v: Record<string, unknown>) =>
            save.mutate({ code: v.code, nameTh: v.nameTh, venueType: v.venueType, buildingId: v.buildingId ?? null, organizationId: v.organizationId ?? null, capacity: v.capacity ?? null, floor: v.floor || null, description: v.description || null, autoApprove: !!v.autoApprove, isActive: !!v.isActive })
          }
        >
          <Row gutter={12}>
            <Col xs={24} md={8}><Form.Item name="code" label="รหัส" rules={[{ required: true, message: 'กรุณาระบุรหัส' }]}><Input maxLength={30} /></Form.Item></Col>
            <Col xs={24} md={16}><Form.Item name="nameTh" label="ชื่อ" rules={[{ required: true, message: 'กรุณาระบุชื่อ' }]}><Input maxLength={300} /></Form.Item></Col>
            <Col xs={24} md={8}><Form.Item name="venueType" label="ประเภท"><Select options={Object.entries(VENUE_TYPE_LABEL).map(([value, label]) => ({ value, label }))} /></Form.Item></Col>
            <Col xs={12} md={8}><Form.Item name="capacity" label="จำนวนที่นั่ง"><InputNumber min={1} style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={12} md={8}><Form.Item name="floor" label="ชั้น"><Input maxLength={20} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="buildingId" label="อาคาร"><Select allowClear options={(buildings.data ?? []).map((b) => ({ value: b.id, label: b.nameTh }))} /></Form.Item></Col>
            <Col xs={24} md={12}>
              <Form.Item name="organizationId" label="หน่วยงานผู้ดูแล (อนุมัติการจอง)" extra="เว้นว่าง = ส่วนกลาง">
                <Select allowClear showSearch optionFilterProp="label" options={(orgs.data ?? []).map((o) => ({ value: o.id, label: o.nameTh }))} />
              </Form.Item>
            </Col>
            <Col span={24}><Form.Item name="description" label="รายละเอียด / สิ่งอำนวยความสะดวก"><Input.TextArea rows={2} maxLength={2000} /></Form.Item></Col>
            <Col span={24}>
              <Space size={24} wrap>
                <Form.Item name="autoApprove" valuePropName="checked" noStyle><Checkbox>อนุมัติอัตโนมัติเมื่อว่าง</Checkbox></Form.Item>
                <Form.Item name="isActive" valuePropName="checked" noStyle><Checkbox>เปิดให้จอง</Checkbox></Form.Item>
              </Space>
            </Col>
          </Row>
        </Form>
      </Modal>
    </>
  );
}

/** Movable / fixed equipment with stock. */
export function ResourceCatalog() {
  const can = useCan();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const orgs = useOrgs();
  const venues = useQuery({ queryKey: ['venues', 'all-active'], queryFn: () => api.getPage<Venue>('/venues', { perPage: 100 }), staleTime: 60_000 });
  const [q, setQ] = useState<{ page: number; perPage: number; search?: string; includeInactive: 'true' }>({ page: 1, perPage: 20, includeInactive: 'true' });
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Resource | 'new' | null>(null);
  const [form] = Form.useForm();
  const list = useQuery({ queryKey: ['resources', q], queryFn: () => api.getPage<Resource>('/resources', q), placeholderData: keepPreviousData });
  const save = useMutation({
    mutationFn: (v: Record<string, unknown>) => (editing === 'new' ? api.post('/resources', v) : api.patch(`/resources/${(editing as Resource).id}`, v)),
    onSuccess: () => {
      msg.success('บันทึกแล้ว');
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['resources'] });
    },
    onError: msg.error,
  });
  const open = (r: Resource | 'new') => {
    form.resetFields();
    form.setFieldsValue(r === 'new' ? { quantity: 1, isActive: true } : { ...r });
    setEditing(r);
  };

  return (
    <>
      <Flex justify="space-between" gap={12} wrap style={{ marginBottom: 12 }}>
        <Input allowClear prefix={<SearchOutlined />} placeholder="ชื่อ / รหัส / ประเภท" value={search} onChange={(e) => setSearch(e.target.value)} onPressEnter={() => setQ({ ...q, page: 1, search: search.trim() || undefined })} style={{ width: 260 }} />
        {canManage(can) && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
            เพิ่มอุปกรณ์
          </Button>
        )}
      </Flex>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <Table<Resource>
          rowKey="id"
          size="middle"
          loading={list.isFetching}
          dataSource={list.data?.items ?? []}
          scroll={{ x: 860 }}
          pagination={{ current: q.page, pageSize: q.perPage, total: list.data?.meta.total ?? 0, onChange: (page, perPage) => setQ({ ...q, page, perPage }) }}
          columns={[
            { title: 'รหัส', dataIndex: 'code', width: 120 },
            { title: 'ชื่อ', render: (_, r) => (<><div>{r.nameTh}</div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.resourceType}{r.venue ? ` · ประจำ ${r.venue.nameTh}` : ''}</Typography.Text></>) },
            { title: 'จำนวน', width: 90, dataIndex: 'quantity' },
            { title: 'ผู้ดูแล/อนุมัติ', width: 220, render: (_, r) => r.organization?.nameTh ?? <Tag>ส่วนกลาง</Tag> },
            { title: 'สถานะ', width: 90, render: (_, r) => (r.isActive ? <Tag color="green">ใช้งาน</Tag> : <Tag>ปิด</Tag>) },
            { title: '', width: 60, render: (_, r) => canManage(can) && <Button size="small" icon={<EditOutlined />} aria-label="แก้ไข" onClick={() => open(r)} /> },
          ]}
        />
      )}
      <Modal open={!!editing} title={editing === 'new' ? 'เพิ่มอุปกรณ์' : 'แก้ไขอุปกรณ์'} okText="บันทึก" cancelText="ยกเลิก" onCancel={() => setEditing(null)} onOk={() => form.submit()} okButtonProps={{ loading: save.isPending }} width={640} forceRender>
        <Form
          form={form}
          layout="vertical"
          onFinish={(v: Record<string, unknown>) =>
            save.mutate({ code: v.code, nameTh: v.nameTh, resourceType: v.resourceType, quantity: v.quantity, venueId: v.venueId ?? null, organizationId: v.organizationId ?? null, description: v.description || null, isActive: !!v.isActive })
          }
        >
          <Row gutter={12}>
            <Col xs={24} md={8}><Form.Item name="code" label="รหัส" rules={[{ required: true, message: 'กรุณาระบุรหัส' }]}><Input maxLength={30} /></Form.Item></Col>
            <Col xs={24} md={16}><Form.Item name="nameTh" label="ชื่อ" rules={[{ required: true, message: 'กรุณาระบุชื่อ' }]}><Input maxLength={300} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="resourceType" label="ประเภท" rules={[{ required: true, message: 'กรุณาระบุประเภท' }]}><Input maxLength={100} placeholder="เช่น โสตทัศนูปกรณ์" /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="quantity" label="จำนวนทั้งหมด" rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="venueId" label="ติดตั้งประจำสถานที่"><Select allowClear showSearch optionFilterProp="label" options={(venues.data?.items ?? []).map((v) => ({ value: v.id, label: v.nameTh }))} /></Form.Item></Col>
            <Col xs={24} md={12}><Form.Item name="organizationId" label="หน่วยงานผู้ดูแล" extra="เว้นว่าง = ส่วนกลาง"><Select allowClear showSearch optionFilterProp="label" options={(orgs.data ?? []).map((o) => ({ value: o.id, label: o.nameTh }))} /></Form.Item></Col>
            <Col span={24}><Form.Item name="description" label="รายละเอียด"><Input.TextArea rows={2} maxLength={1000} /></Form.Item></Col>
            <Col span={24}><Form.Item name="isActive" valuePropName="checked" noStyle><Checkbox>เปิดให้ยืม</Checkbox></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
    </>
  );
}

export function BuildingCatalog() {
  const can = useCan();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const list = useBuildings();
  const [editing, setEditing] = useState<Building | 'new' | null>(null);
  const [form] = Form.useForm();
  const save = useMutation({
    mutationFn: (v: Record<string, unknown>) => (editing === 'new' ? api.post('/buildings', v) : api.patch(`/buildings/${(editing as Building).id}`, v)),
    onSuccess: () => {
      msg.success('บันทึกแล้ว');
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['buildings'] });
    },
    onError: msg.error,
  });
  const open = (b: Building | 'new') => {
    form.resetFields();
    form.setFieldsValue(b === 'new' ? { isActive: true } : { ...b });
    setEditing(b);
  };
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  return (
    <>
      {canManage(can) && (
        <Flex justify="end" style={{ marginBottom: 12 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>เพิ่มอาคาร</Button>
        </Flex>
      )}
      <Table<Building>
        rowKey="id"
        size="middle"
        loading={list.isPending}
        dataSource={list.data ?? []}
        pagination={false}
        scroll={{ x: 640 }}
        columns={[
          { title: 'รหัส', dataIndex: 'code', width: 120 },
          { title: 'ชื่อ', dataIndex: 'nameTh' },
          { title: 'วิทยาเขต', dataIndex: 'campus', width: 180 },
          { title: 'สถานที่', width: 90, render: (_, b) => b._count?.venues ?? 0 },
          { title: '', width: 60, render: (_, b) => canManage(can) && <Button size="small" icon={<EditOutlined />} aria-label="แก้ไข" onClick={() => open(b)} /> },
        ]}
      />
      <Modal open={!!editing} title={editing === 'new' ? 'เพิ่มอาคาร' : 'แก้ไขอาคาร'} okText="บันทึก" cancelText="ยกเลิก" onCancel={() => setEditing(null)} onOk={() => form.submit()} okButtonProps={{ loading: save.isPending }} forceRender>
        <Form form={form} layout="vertical" onFinish={(v: Record<string, unknown>) => save.mutate({ code: v.code, nameTh: v.nameTh, campus: v.campus || null, address: v.address || null, isActive: !!v.isActive })}>
          <Form.Item name="code" label="รหัส" rules={[{ required: true }]}><Input maxLength={30} /></Form.Item>
          <Form.Item name="nameTh" label="ชื่อ" rules={[{ required: true }]}><Input maxLength={300} /></Form.Item>
          <Form.Item name="campus" label="วิทยาเขต"><Input maxLength={200} /></Form.Item>
          <Form.Item name="address" label="ที่ตั้ง"><Input maxLength={500} /></Form.Item>
          <Form.Item name="isActive" valuePropName="checked"><Checkbox>ใช้งาน</Checkbox></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
