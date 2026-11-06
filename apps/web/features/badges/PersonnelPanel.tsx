'use client';

import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { ApiError } from '@sru/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Col, Flex, Form, Input, Modal, Popconfirm, Row, Select, Switch, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { ErrorState } from '@/components/QueryState';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';
import { ROLE_LABEL, type Personnel } from './types';

type Values = Omit<Personnel, 'id' | 'badgePrints' | 'user' | 'userId'> & { userEmail?: string };

/** Speakers, staff, VIPs … who need a badge; linking an account can grant a check-in desk for this event. */
export function PersonnelPanel({ eventId }: { eventId: string }) {
  const can = useCan();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const [editing, setEditing] = useState<Partial<Personnel> | null>(null);
  const [form] = Form.useForm<Values>();
  const list = useQuery({ queryKey: ['personnel', eventId], queryFn: () => api.get<Personnel[]>(`/events/${eventId}/personnel`) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['personnel', eventId] });
    void qc.invalidateQueries({ queryKey: ['badge-candidates', eventId] });
  };

  const save = useMutation({
    mutationFn: async ({ userEmail, ...v }: Values) => {
      let userId: string | null = null;
      if (userEmail?.trim()) {
        const u = await api.get<{ id: string } | null>(`/events/${eventId}/personnel/user-lookup`, { email: userEmail.trim() });
        if (!u) throw new ApiError(404, 'NOT_FOUND', 'ไม่พบบัญชีผู้ใช้ที่ใช้อีเมลนี้');
        userId = u.id;
      }
      const body = { ...v, userId, email: v.email || undefined, phone: v.phone || undefined, prefix: v.prefix || undefined, position: v.position || undefined, affiliation: v.affiliation || undefined };
      return editing?.id ? api.patch(`/event-personnel/${editing.id}`, body) : api.post(`/events/${eventId}/personnel`, body);
    },
    onSuccess: () => {
      msg.success('บันทึกแล้ว');
      setEditing(null);
      refresh();
    },
    onError: msg.error,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/event-personnel/${id}`),
    onSuccess: refresh,
    onError: msg.error,
  });

  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  const editable = can('event:update');
  return (
    <>
      <Flex justify="space-between" align="center" style={{ marginBottom: 12 }} gap={12} wrap>
        <Typography.Text type="secondary">บุคคลที่ต้องมีป้ายชื่อแต่ไม่ได้ลงทะเบียน — ป้ายใช้สีตามบทบาท (ตั้งได้ในแม่แบบ)</Typography.Text>
        {editable && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing({});
              form.resetFields();
              form.setFieldsValue({ role: 'SPEAKER', canCheckin: false });
            }}
          >
            เพิ่มบุคลากร
          </Button>
        )}
      </Flex>
      <Table<Personnel>
        rowKey="id"
        size="small"
        loading={list.isPending}
        dataSource={list.data}
        pagination={false}
        scroll={{ x: 860 }}
        locale={{ emptyText: 'ยังไม่มีบุคลากรของงาน' }}
        columns={[
          { title: 'บทบาท', dataIndex: 'role', width: 130, render: (r) => <Tag>{ROLE_LABEL[r] ?? r}</Tag> },
          { title: 'ชื่อ', render: (_, p) => `${p.prefix ?? ''}${p.firstName} ${p.lastName}` },
          { title: 'ตำแหน่ง / หน่วยงาน', render: (_, p) => [p.position, p.affiliation].filter(Boolean).join(' · ') || '-' },
          { title: 'บัญชีผู้ใช้', render: (_, p) => (p.user ? <>{p.user.displayName} {p.canCheckin && <Tag color="green">เปิดจุดเช็กอินได้</Tag>}</> : '-') },
          { title: 'ป้าย', dataIndex: 'badgePrints', width: 90, render: (n) => (n ? `พิมพ์ ${n}` : '-') },
          {
            title: '',
            width: 90,
            render: (_, p) =>
              editable && (
                <>
                  <Button
                    size="small"
                    type="text"
                    icon={<EditOutlined />}
                    aria-label="แก้ไข"
                    onClick={() => {
                      setEditing(p);
                      form.setFieldsValue({ ...p, prefix: p.prefix ?? undefined, userEmail: p.user?.email } as Values);
                    }}
                  />
                  <Popconfirm title="ลบบุคลากรนี้?" okText="ลบ" cancelText="ไม่" okButtonProps={{ danger: true }} onConfirm={() => remove.mutate(p.id)}>
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label="ลบ" />
                  </Popconfirm>
                </>
              ),
          },
        ]}
      />
      <Modal open={!!editing} title={editing?.id ? 'แก้ไขบุคลากร' : 'เพิ่มบุคลากรของงาน'} okText="บันทึก" cancelText="ยกเลิก" onCancel={() => setEditing(null)} onOk={() => form.submit()} okButtonProps={{ loading: save.isPending }} width={640} forceRender>
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Row gutter={12}>
            <Col xs={24} md={8}>
              <Form.Item name="role" label="บทบาท" rules={[{ required: true }]}>
                <Select options={Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={4}>
              <Form.Item name="prefix" label="คำนำหน้า">
                <Input maxLength={50} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="firstName" label="ชื่อ" rules={[{ required: true, message: 'กรุณาระบุชื่อ' }]}>
                <Input maxLength={150} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="lastName" label="นามสกุล" rules={[{ required: true, message: 'กรุณาระบุนามสกุล' }]}>
                <Input maxLength={150} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="position" label="ตำแหน่ง">
                <Input maxLength={300} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="affiliation" label="หน่วยงาน">
                <Input maxLength={300} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="email" label="อีเมลติดต่อ" rules={[{ type: 'email', message: 'อีเมลไม่ถูกต้อง' }]}>
                <Input maxLength={254} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="phone" label="โทรศัพท์">
                <Input maxLength={20} />
              </Form.Item>
            </Col>
          </Row>
          <Alert type="info" showIcon style={{ marginBottom: 12 }} title="มอบหน้าที่จุดเช็กอินสำหรับงานนี้" description="ผูกกับบัญชีผู้ใช้ (ด้วยอีเมลที่ใช้เข้าสู่ระบบ) แล้วเปิดสิทธิ์ — ผู้ใช้ต้องมีบทบาทที่มีสิทธิ์เช็กอินอยู่แล้ว เช่น เจ้าหน้าที่ประจำงาน ระบบจะให้ใช้ได้เฉพาะกิจกรรมนี้" />
          <Row gutter={12}>
            <Col xs={24} md={16}>
              <Form.Item name="userEmail" label="อีเมลบัญชีผู้ใช้" rules={[{ type: 'email', message: 'อีเมลไม่ถูกต้อง' }]}>
                <Input maxLength={254} placeholder="ไม่ต้องระบุ หากไม่มอบหน้าที่เช็กอิน" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="canCheckin" label="เปิดจุดเช็กอินได้" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </>
  );
}
