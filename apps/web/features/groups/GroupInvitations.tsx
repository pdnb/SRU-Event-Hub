'use client';

import { LinkOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import type { GroupDetailDto } from '@sru/shared-types';
import { Alert, Button, Form, InputNumber, Modal, Popconfirm, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { ThaiDate } from '@/components/Format';
import { useApiMessage } from '@/hooks/useApiMessage';
import { api } from '@/services/api';

type Created = { id: string; token: string; expiresAt: string; maxUses: number };

/** Link carrying the token in the URL fragment (never sent to servers / written to access logs). */
export const inviteUrl = (token: string) => `${typeof window === 'undefined' ? '' : window.location.origin}/group-invite#token=${encodeURIComponent(token)}`;

export function useCreateInvitation(groupId: string, onDone: () => void) {
  const msg = useApiMessage();
  const [created, setCreated] = useState<(Created & { memberName?: string }) | null>(null);
  const mutation = useMutation({
    mutationFn: (v: { registrationId?: string; maxUses?: number; expiresInDays?: number; memberName?: string }) =>
      api.post<Created>(`/groups/${groupId}/invitations`, { registrationId: v.registrationId, maxUses: v.maxUses, expiresInDays: v.expiresInDays }).then((c) => ({ ...c, memberName: v.memberName })),
    onSuccess: (c) => {
      setCreated(c);
      onDone();
    },
    onError: msg.error,
  });
  const dialog = (
    <Modal open={!!created} title="ลิงก์เชิญ" footer={<Button type="primary" onClick={() => setCreated(null)}>ปิด</Button>} onCancel={() => setCreated(null)}>
      {created && (
        <>
          <Alert type="warning" showIcon style={{ marginBottom: 12 }} title="คัดลอกลิงก์เก็บไว้ตอนนี้ — ระบบแสดงลิงก์นี้เพียงครั้งเดียว" />
          <Typography.Paragraph>
            {created.memberName ? `สำหรับ ${created.memberName} ตรวจ/กรอกข้อมูลของตนเอง` : `ลิงก์เปิด: ใช้เพิ่มสมาชิกใหม่ได้ ${created.maxUses} คน`} · หมดอายุ <ThaiDate value={created.expiresAt} time />
          </Typography.Paragraph>
          <Typography.Paragraph copyable={{ text: inviteUrl(created.token) }} code style={{ wordBreak: 'break-all' }}>
            {inviteUrl(created.token)}
          </Typography.Paragraph>
        </>
      )}
    </Modal>
  );
  return { create: mutation.mutate, pending: mutation.isPending, dialog };
}

/** Open links (add new members while DRAFT) and the list of every link with revoke. */
export function GroupInvitations({ group, onChanged }: { group: GroupDetailDto; onChanged: () => void }) {
  const msg = useApiMessage();
  const [form] = Form.useForm<{ maxUses: number; expiresInDays: number }>();
  const { create, pending, dialog } = useCreateInvitation(group.id, onChanged);
  const revoke = useMutation({
    mutationFn: (id: string) => api.post(`/groups/${group.id}/invitations/${id}/revoke`),
    onSuccess: () => {
      msg.success('ปิดลิงก์แล้ว');
      onChanged();
    },
    onError: msg.error,
  });
  const room = Math.max(1, group.settings.maxMembers - group.memberCount);

  return (
    <>
      {group.status === 'DRAFT' ? (
        <Form form={form} layout="inline" initialValues={{ maxUses: room, expiresInDays: 7 }} onFinish={(v) => create(v)} style={{ marginBottom: 16, rowGap: 8 }}>
          <Form.Item name="maxUses" label="ใช้ได้ (คน)">
            <InputNumber min={1} max={room} />
          </Form.Item>
          <Form.Item name="expiresInDays" label="หมดอายุใน (วัน)">
            <InputNumber min={1} max={60} />
          </Form.Item>
          <Button type="primary" htmlType="submit" icon={<LinkOutlined />} loading={pending}>
            สร้างลิงก์เชิญแบบเปิด
          </Button>
        </Form>
      ) : (
        <Alert type="info" showIcon style={{ marginBottom: 16 }} title="หลังส่งกลุ่มแล้ว สร้างลิงก์ได้เฉพาะรายบุคคล (ปุ่ม “ลิงก์” ในตารางสมาชิก) ให้สมาชิกตรวจ/แก้ข้อมูลของตนเอง" />
      )}
      <Typography.Paragraph type="secondary">
        ผู้ได้รับลิงก์กรอกข้อมูลและให้ความยินยอม PDPA ด้วยตนเองโดยไม่ต้องเข้าสู่ระบบ และเห็นเฉพาะข้อมูลของตนเอง
      </Typography.Paragraph>
      <Table
        size="small"
        rowKey="id"
        dataSource={group.invitations}
        pagination={false}
        locale={{ emptyText: 'ยังไม่มีลิงก์เชิญ' }}
        scroll={{ x: 640 }}
        columns={[
          { title: 'ประเภท', render: (_, i) => (i.registrationId ? `รายบุคคล: ${i.memberName ?? '-'}` : 'ลิงก์เปิด (เพิ่มสมาชิก)') },
          { title: 'ใช้แล้ว', width: 90, render: (_, i) => `${i.usedCount}/${i.maxUses}` },
          { title: 'หมดอายุ', width: 170, render: (_, i) => <ThaiDate value={i.expiresAt} time /> },
          {
            title: 'สถานะ',
            width: 100,
            render: (_, i) =>
              i.revoked ? <Tag>ปิดแล้ว</Tag> : new Date(i.expiresAt) < new Date() ? <Tag>หมดอายุ</Tag> : i.usedCount >= i.maxUses ? <Tag color="blue">ใช้ครบ</Tag> : <Tag color="green">ใช้งานได้</Tag>,
          },
          {
            title: '',
            width: 80,
            render: (_, i) =>
              !i.revoked && (
                <Popconfirm title="ปิดลิงก์นี้?" okText="ปิดลิงก์" cancelText="ไม่" onConfirm={() => revoke.mutate(i.id)}>
                  <Button size="small" type="link" danger>
                    ปิดลิงก์
                  </Button>
                </Popconfirm>
              ),
          },
        ]}
      />
      {dialog}
    </>
  );
}
