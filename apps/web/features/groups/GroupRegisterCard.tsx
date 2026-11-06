'use client';

import { PlusOutlined, TeamOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Form, Input, Modal, Select, Space, Typography } from 'antd';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { newIdempotencyKey } from '@sru/api-client';
import type { EventDetailDto, EventGroupSettingDto, GroupDetailDto, ParticipantOrganizationDto } from '@sru/shared-types';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useMe } from '@/hooks/useMe';
import { api } from '@/services/api';
import { ParticipantOrgForm } from './ParticipantOrgForm';

/** Event page: entry point for a coordinator registering several people on behalf of an organization. */
export function GroupRegisterCard({ event }: { event: EventDetailDto }) {
  const settings = useQuery({
    queryKey: ['group-settings', event.id],
    queryFn: () => api.get<EventGroupSettingDto>(`/public/events/${event.id}/group-settings`),
    staleTime: 60_000,
  });
  const me = useMe();
  const [open, setOpen] = useState(false);
  const s = settings.data;
  if (!s?.isEnabled || !event.registrationOpen) return null;

  return (
    <Card size="small" style={{ marginTop: 16 }} title={<Space><TeamOutlined />ลงทะเบียนแบบกลุ่ม</Space>}>
      <Typography.Paragraph style={{ marginTop: 0 }}>
        สำหรับโรงเรียน หน่วยงาน หรือองค์กรที่ส่งผู้เข้าร่วมครั้งละ {s.minMembers}–{s.maxMembers} คน ผู้ประสานงานกรอกรายชื่อเอง นำเข้าจาก Excel หรือส่งลิงก์ให้สมาชิกกรอก แล้วชำระเงินรวมครั้งเดียว
      </Typography.Paragraph>
      {me.data ? (
        <Button block icon={<TeamOutlined />} onClick={() => setOpen(true)}>
          เริ่มลงทะเบียนแบบกลุ่ม
        </Button>
      ) : (
        <Link href={`/login?next=/events/${event.code}`}>
          <Button block>เข้าสู่ระบบเพื่อลงทะเบียนแบบกลุ่ม</Button>
        </Link>
      )}
      {open && <CreateGroupModal event={event} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function CreateGroupModal({ event, onClose }: { event: EventDetailDto; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const [form] = Form.useForm<{ participantOrganizationId: string; name: string; contactPhone?: string }>();
  const [orgForm, setOrgForm] = useState(false);
  const idem = useRef(newIdempotencyKey());
  const orgs = useQuery({ queryKey: ['my-participant-orgs'], queryFn: () => api.get<ParticipantOrganizationDto[]>('/me/participant-orgs') });
  const create = useMutation({
    mutationFn: (v: { participantOrganizationId: string; name: string; contactPhone?: string }) =>
      api.post<GroupDetailDto>(`/events/${event.id}/groups`, { ...v, contactPhone: v.contactPhone || undefined }, { headers: { 'Idempotency-Key': idem.current } }),
    onSuccess: (g) => {
      msg.success(`สร้างกลุ่ม ${g.groupNo} แล้ว — เพิ่มรายชื่อสมาชิกได้เลย`);
      router.push(`/my/groups/${g.id}`);
    },
    onError: (e) => {
      idem.current = newIdempotencyKey();
      msg.error(e);
    },
  });

  return (
    <Modal open title="สร้างกลุ่มลงทะเบียน" okText="สร้างกลุ่ม" cancelText="ยกเลิก" onOk={() => form.submit()} onCancel={onClose} confirmLoading={create.isPending} destroyOnHidden>
      <Typography.Paragraph type="secondary">กิจกรรม: {event.titleTh}</Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
        <Form.Item label="ในนามองค์กร" required>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="participantOrganizationId" noStyle rules={[{ required: true, message: 'กรุณาเลือกองค์กร' }]}>
              <Select
                loading={orgs.isPending}
                placeholder={orgs.data?.length ? 'เลือกองค์กร' : 'ยังไม่มีองค์กร — กด "เพิ่มองค์กร"'}
                options={orgs.data?.map((o) => ({ value: o.id, label: o.nameTh }))}
                style={{ width: '100%' }}
              />
            </Form.Item>
            <Button icon={<PlusOutlined />} onClick={() => setOrgForm(true)}>
              เพิ่มองค์กร
            </Button>
          </Space.Compact>
        </Form.Item>
        <Form.Item name="name" label="ชื่อกลุ่ม" rules={[{ required: true, min: 2, message: 'กรุณาตั้งชื่อกลุ่ม' }]} extra="เช่น นักเรียนชั้น ม.5 ห้อง 2">
          <Input maxLength={300} />
        </Form.Item>
        <Form.Item name="contactPhone" label="โทรศัพท์ติดต่อผู้ประสานงาน" rules={[{ pattern: /^0\d{8,9}$/, message: 'เบอร์โทรศัพท์ไม่ถูกต้อง' }]}>
          <Input inputMode="tel" maxLength={10} />
        </Form.Item>
      </Form>
      <ParticipantOrgForm
        open={orgForm}
        onClose={() => setOrgForm(false)}
        onSaved={(o) => {
          setOrgForm(false);
          void qc.invalidateQueries({ queryKey: ['my-participant-orgs'] });
          form.setFieldValue('participantOrganizationId', o.id);
        }}
      />
    </Modal>
  );
}
