'use client';

import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Col, Drawer, Flex, Form, Input, Modal, Popconfirm, Row, Select, Table, Tag } from 'antd';
import { useState } from 'react';
import type { OrganizationDto } from '@sru/shared-types';
import { ThaiDate } from '@/components/Format';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/QueryState';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';

type UserRow = {
  id: string;
  email: string;
  username: string | null;
  displayName: string;
  userType: string;
  status: string;
  localLogin: boolean;
  lastLoginAt: string | null;
  staffCode: string | null;
  studentCode: string | null;
  roles: { id: string; code: string; nameTh: string; scope: string; organization: { id: string; nameTh: string } | null }[];
};

const USER_TYPES: Record<string, string> = { STAFF: 'บุคลากร', STUDENT: 'นักศึกษา', EXTERNAL: 'บุคคลภายนอก' };
const STATUS: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: 'ใช้งาน', color: 'green' },
  SUSPENDED: { label: 'ระงับ', color: 'red' },
  PENDING_VERIFICATION: { label: 'รอยืนยันอีเมล', color: 'gold' },
};
const SCOPES: Record<string, string> = { ALL: 'ทุกหน่วยงาน', ORGANIZATION_TREE: 'หน่วยงานและหน่วยงานย่อย', ORGANIZATION: 'เฉพาะหน่วยงาน', OWN: 'เฉพาะของตนเอง' };

export default function UsersPage() {
  const can = useCan();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const [q, setQ] = useState<{ page: number; perPage: number; search?: string; status?: string; userType?: string }>({ page: 1, perPage: 20 });
  const [search, setSearch] = useState('');
  const [grantFor, setGrantFor] = useState<UserRow | null>(null);
  const [suspendFor, setSuspendFor] = useState<UserRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [grantForm] = Form.useForm();
  const [statusForm] = Form.useForm();
  const [createForm] = Form.useForm();

  const users = useQuery({ queryKey: ['users', q], queryFn: () => api.getPage<UserRow>('/users', q), placeholderData: keepPreviousData });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<{ code: string; nameTh: string }[]>('/roles'), enabled: can('role:view') });
  const orgs = useQuery({ queryKey: ['orgs-public'], queryFn: () => api.get<OrganizationDto[]>('/organizations'), staleTime: 600_000 });
  const done = (text: string) => () => {
    msg.success(text);
    void qc.invalidateQueries({ queryKey: ['users'] });
  };

  const grant = useMutation({
    mutationFn: (v: { roleCode: string; organizationId?: string; scope: string }) => api.post(`/users/${grantFor!.id}/roles`, v),
    onSuccess: () => {
      done('กำหนดสิทธิ์แล้ว')();
      setGrantFor(null);
      grantForm.resetFields();
    },
    onError: msg.error,
  });
  const revoke = useMutation({ mutationFn: ({ userId, grantId }: { userId: string; grantId: string }) => api.del(`/users/${userId}/roles/${grantId}`), onSuccess: done('เพิกถอนสิทธิ์แล้ว'), onError: msg.error });
  const setStatus = useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: string; reason: string }) => api.patch(`/users/${id}/status`, { status, reason }),
    onSuccess: () => {
      done('เปลี่ยนสถานะแล้ว')();
      setSuspendFor(null);
      statusForm.resetFields();
    },
    onError: msg.error,
  });
  const create = useMutation({
    mutationFn: (v: Record<string, string>) => api.post('/users', Object.fromEntries(Object.entries(v).filter(([, x]) => x))),
    onSuccess: () => {
      done('สร้างบัญชีแล้ว')();
      setCreating(false);
      createForm.resetFields();
    },
    onError: msg.error,
  });

  return (
    <>
      <PageHeader
        title="จัดการผู้ใช้งาน"
        description="บัญชีผู้ใช้ บทบาท และขอบเขตข้อมูลตามหน่วยงาน"
        breadcrumb={[{ title: 'จัดการผู้ใช้งาน' }]}
        actions={can('user:create') && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>เพิ่มผู้ใช้</Button>}
      />
      <Card>
        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
          <Col xs={24} md={10}>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="ค้นหาชื่อ อีเมล รหัสบุคลากร/นักศึกษา"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (!e.target.value) setQ({ ...q, search: undefined, page: 1 });
              }}
              onPressEnter={() => setQ({ ...q, search: search.trim() || undefined, page: 1 })}
            />
          </Col>
          <Col xs={12} md={5}>
            <Select allowClear placeholder="ประเภท" style={{ width: '100%' }} value={q.userType} onChange={(userType) => setQ({ ...q, userType, page: 1 })} options={Object.entries(USER_TYPES).map(([value, label]) => ({ value, label }))} />
          </Col>
          <Col xs={12} md={5}>
            <Select allowClear placeholder="สถานะ" style={{ width: '100%' }} value={q.status} onChange={(status) => setQ({ ...q, status, page: 1 })} options={Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))} />
          </Col>
        </Row>
        {users.isError ? (
          <ErrorState error={users.error} onRetry={() => users.refetch()} />
        ) : (
          <Table<UserRow>
            rowKey="id"
            loading={users.isFetching}
            dataSource={users.data?.items}
            scroll={{ x: 1000 }}
            pagination={{ current: q.page, pageSize: q.perPage, total: users.data?.meta.total, showTotal: (t) => `ทั้งหมด ${t} บัญชี`, onChange: (page, perPage) => setQ({ ...q, page, perPage }) }}
            columns={[
              { title: 'ชื่อ', dataIndex: 'displayName', render: (n, r) => <><div>{n}</div><small style={{ color: '#6b7280' }}>{r.email}</small></> },
              { title: 'ประเภท', dataIndex: 'userType', width: 110, render: (t) => USER_TYPES[t] },
              { title: 'รหัส', width: 120, render: (_, r) => r.staffCode ?? r.studentCode ?? '-' },
              {
                title: 'บทบาท',
                render: (_, r) => (
                  <Flex gap={4} wrap>
                    {r.roles.map((g) => (
                      <Tag
                        key={g.id}
                        closable={can('role:update')}
                        onClose={(e) => {
                          e.preventDefault();
                          revoke.mutate({ userId: r.id, grantId: g.id });
                        }}
                        title={`${SCOPES[g.scope]}${g.organization ? ` · ${g.organization.nameTh}` : ''}`}
                      >
                        {g.nameTh}
                        {g.organization ? ` · ${g.organization.nameTh}` : ''}
                      </Tag>
                    ))}
                  </Flex>
                ),
              },
              { title: 'เข้าใช้ล่าสุด', dataIndex: 'lastLoginAt', width: 170, render: (d) => <ThaiDate value={d} time /> },
              { title: 'สถานะ', dataIndex: 'status', width: 110, render: (s) => <Tag color={STATUS[s]?.color}>{STATUS[s]?.label ?? s}</Tag> },
              {
                title: '',
                width: 190,
                render: (_, r) => (
                  <Flex gap={4}>
                    {can('role:update') && <Button size="small" type="link" onClick={() => setGrantFor(r)}>เพิ่มสิทธิ์</Button>}
                    {can('user:update') &&
                      (r.status === 'ACTIVE' ? (
                        <Button size="small" type="link" danger onClick={() => setSuspendFor(r)}>ระงับ</Button>
                      ) : (
                        <Popconfirm title="เปิดใช้งานบัญชีนี้?" okText="ยืนยัน" cancelText="ไม่" onConfirm={() => setStatus.mutate({ id: r.id, status: 'ACTIVE', reason: 'เปิดใช้งานโดยผู้ดูแลระบบ' })}>
                          <Button size="small" type="link">เปิดใช้งาน</Button>
                        </Popconfirm>
                      ))}
                  </Flex>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Modal open={!!grantFor} title={`เพิ่มสิทธิ์: ${grantFor?.displayName ?? ''}`} okText="บันทึก" cancelText="ยกเลิก" onCancel={() => setGrantFor(null)} onOk={() => grantForm.submit()} confirmLoading={grant.isPending} destroyOnHidden>
        <Form form={grantForm} layout="vertical" onFinish={(v) => grant.mutate(v)} initialValues={{ scope: 'ORGANIZATION_TREE' }} preserve={false}>
          <Form.Item name="roleCode" label="บทบาท" rules={[{ required: true, message: 'กรุณาเลือกบทบาท' }]}>
            <Select options={roles.data?.map((r) => ({ value: r.code, label: r.nameTh }))} />
          </Form.Item>
          <Form.Item name="scope" label="ขอบเขตข้อมูล" rules={[{ required: true }]}>
            <Select options={Object.entries(SCOPES).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item noStyle dependencies={['scope']}>
            {({ getFieldValue }) =>
              ['ORGANIZATION', 'ORGANIZATION_TREE'].includes(getFieldValue('scope')) && (
                <Form.Item name="organizationId" label="หน่วยงาน" rules={[{ required: true, message: 'กรุณาเลือกหน่วยงาน' }]}>
                  <Select showSearch={{ optionFilterProp: 'label' }} options={orgs.data?.map((o) => ({ value: o.id, label: o.nameTh }))} />
                </Form.Item>
              )
            }
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={!!suspendFor} title={`ระงับบัญชี: ${suspendFor?.displayName ?? ''}`} okText="ระงับบัญชี" okButtonProps={{ danger: true }} cancelText="ยกเลิก" onCancel={() => setSuspendFor(null)} onOk={() => statusForm.submit()} confirmLoading={setStatus.isPending} destroyOnHidden>
        <Form form={statusForm} layout="vertical" preserve={false} onFinish={(v: { reason: string }) => setStatus.mutate({ id: suspendFor!.id, status: 'SUSPENDED', reason: v.reason })}>
          <Form.Item name="reason" label="เหตุผล" rules={[{ required: true, min: 3, message: 'กรุณาระบุเหตุผล' }]}>
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer open={creating} onClose={() => setCreating(false)} title="เพิ่มผู้ใช้" size={480} destroyOnHidden extra={<Button type="primary" loading={create.isPending} onClick={() => createForm.submit()}>บันทึก</Button>}>
        <Form form={createForm} layout="vertical" onFinish={(v) => create.mutate(v)} initialValues={{ userType: 'STAFF' }} preserve={false}>
          <Form.Item name="email" label="อีเมล" rules={[{ required: true, type: 'email', message: 'กรุณาระบุอีเมลที่ถูกต้อง' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="displayName" label="ชื่อ-นามสกุล" rules={[{ required: true, min: 2 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="userType" label="ประเภท" rules={[{ required: true }]}>
            <Select options={Object.entries(USER_TYPES).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item name="username" label="ชื่อผู้ใช้ (ถ้ามี)" rules={[{ pattern: /^[a-zA-Z0-9._-]{3,100}$/, message: 'a-z 0-9 . _ - อย่างน้อย 3 ตัว' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="รหัสผ่าน (เว้นว่างหากใช้ Google เท่านั้น)" rules={[{ min: 10, message: 'อย่างน้อย 10 ตัวอักษร' }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="staffCode" label="รหัสบุคลากร">
            <Input />
          </Form.Item>
          <Form.Item name="studentCode" label="รหัสนักศึกษา">
            <Input />
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
