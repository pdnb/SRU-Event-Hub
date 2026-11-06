'use client';

import { CheckCircleTwoTone, DeleteOutlined, EditOutlined, LinkOutlined, PlusOutlined, SendOutlined, StopOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GroupChangeLogDto, GroupDetailDto, GroupMemberDto } from '@sru/shared-types';
import { Alert, Button, Card, Checkbox, Descriptions, Flex, Form, Input, Modal, Space, Table, Tabs, Tag, Timeline, Tooltip, Typography } from 'antd';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { newIdempotencyKey } from '@sru/api-client';
import { Money, ThaiDate } from '@/components/Format';
import { QueryState } from '@/components/QueryState';
import { StatusTag } from '@/components/StatusTag';
import { PaymentPanel } from '@/features/payment/PaymentPanel';
import { useApiMessage } from '@/hooks/useApiMessage';
import { api } from '@/services/api';
import { GroupImportPanel } from './GroupImportPanel';
import { GroupInvitations, useCreateInvitation } from './GroupInvitations';
import { MemberForm, memberToValues, valuesToBody, type MemberValues } from './MemberForm';

export function GroupStatusTag({ status }: { status: string }) {
  return <StatusTag status={status} kind="group" />;
}

const ACTION_LABEL: Record<string, string> = {
  'group.create': 'สร้างกลุ่ม',
  'group.update': 'แก้ไขข้อมูลกลุ่ม',
  'group.submit': 'ส่งกลุ่ม / สำรองที่นั่ง',
  'group.cancel': 'ยกเลิกกลุ่ม',
  'group.expire': 'หมดเวลาชำระเงิน',
  'member.add': 'เพิ่มสมาชิก',
  'member.update': 'แก้ไขข้อมูลสมาชิก',
  'member.substitute': 'เปลี่ยนตัวสมาชิก',
  'member.remove': 'ถอนสมาชิก',
  'order.reissue': 'ออกใบแจ้งชำระใหม่',
  'import.commit': 'นำเข้ารายชื่อจาก Excel',
  'invitation.accept': 'สมาชิกกรอกข้อมูลผ่านลิงก์เชิญ',
};

type Mode = 'coordinator' | 'organizer';

/** Everything about one registration group. Coordinators manage it; organizers view and may cancel. */
export function GroupWorkspace({ groupId, mode }: { groupId: string; mode: Mode }) {
  const qc = useQueryClient();
  const group = useQuery({ queryKey: ['group', groupId], queryFn: () => api.get<GroupDetailDto>(`/groups/${groupId}`) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['group', groupId] });
    void qc.invalidateQueries({ queryKey: ['group-logs', groupId] });
    void qc.invalidateQueries({ queryKey: ['my-groups'] });
  };
  return <QueryState query={group}>{(g) => <Workspace g={g} mode={mode} refresh={refresh} />}</QueryState>;
}

function Workspace({ g, mode, refresh }: { g: GroupDetailDto; mode: Mode; refresh: () => void }) {
  const msg = useApiMessage();
  const coordinator = mode === 'coordinator';
  const open = ['DRAFT', 'PENDING_PAYMENT', 'CONFIRMED'].includes(g.status);
  const editable = coordinator && open && g.canChangeMembers;
  const paidLocked = !!g.payment && ['PAID', 'WAIVED', 'PENDING_VERIFICATION'].includes(g.payment.status);
  const canAddRemove = editable && (g.status === 'DRAFT' || !paidLocked);
  const [memberModal, setMemberModal] = useState<{ member?: GroupMemberDto } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<GroupMemberDto | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const invite = useCreateInvitation(g.id, refresh);
  const logs = useQuery({ queryKey: ['group-logs', g.id], queryFn: () => api.get<GroupChangeLogDto[]>(`/groups/${g.id}/change-logs`) });

  const remove = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => api.post<GroupDetailDto>(`/groups/${g.id}/members/${id}/remove`, { reason }),
    onSuccess: () => {
      msg.success('ถอนสมาชิกแล้ว');
      setRemoveTarget(null);
      refresh();
    },
    onError: msg.error,
  });

  const next =
    g.status === 'DRAFT'
      ? g.memberCount < g.settings.minMembers
        ? `เพิ่มสมาชิกอย่างน้อย ${g.settings.minMembers} คน (สูงสุด ${g.settings.maxMembers} คน) แล้วกด "ส่งกลุ่ม" เพื่อสำรองที่นั่ง`
        : 'รายชื่อพร้อมแล้ว — ตรวจข้อมูลให้ครบแล้วกด "ส่งกลุ่ม" ที่นั่งจะถูกสำรองให้สมาชิกทุกคนพร้อมกัน'
      : g.status === 'PENDING_PAYMENT'
        ? 'สำรองที่นั่งแล้ว กรุณาชำระเงินตามใบแจ้งชำระรวมภายในกำหนด (แท็บ "การชำระเงิน")'
        : null;

  const memberColumns = [
    { title: '#', width: 48, render: (_: unknown, __: GroupMemberDto, i: number) => i + 1 },
    {
      title: 'ชื่อ-นามสกุล',
      render: (_: unknown, m: GroupMemberDto) => (
        <Space size={4}>
          {m.fullName}
          {m.selfConsented && (
            <Tooltip title="สมาชิกให้ความยินยอม/ยืนยันข้อมูลด้วยตนเอง">
              <CheckCircleTwoTone twoToneColor="#16a34a" />
            </Tooltip>
          )}
        </Space>
      ),
    },
    { title: 'อีเมล', dataIndex: 'email', ellipsis: true },
    { title: 'ประเภท', dataIndex: 'participantTypeName', width: 130 },
    ...(g.isPaid ? [{ title: 'ค่าลงทะเบียน', width: 120, render: (_: unknown, m: GroupMemberDto) => (m.feeAmount ? <Money value={m.feeAmount} /> : '-') }] : []),
    { title: 'เลขอ้างอิง', dataIndex: 'referenceNo', width: 160, render: (r: string | null) => (r ? <Typography.Text code>{r}</Typography.Text> : <Typography.Text type="secondary">ยังไม่ส่ง</Typography.Text>) },
    { title: 'สถานะ', dataIndex: 'status', width: 140, render: (s: string) => <StatusTag status={s} kind={s === 'DRAFT' ? 'registration' : undefined} /> },
    ...(editable
      ? [
          {
            title: '',
            width: 200,
            render: (_: unknown, m: GroupMemberDto) => (
              <Space size={0}>
                <Button size="small" type="link" icon={<EditOutlined />} onClick={() => setMemberModal({ member: m })}>
                  {g.status === 'DRAFT' ? 'แก้ไข' : 'แก้ไข/เปลี่ยนตัว'}
                </Button>
                {g.settings.allowInviteLinks && (
                  <Tooltip title="สร้างลิงก์ให้สมาชิกคนนี้ตรวจ/กรอกข้อมูลเอง">
                    <Button size="small" type="link" icon={<LinkOutlined />} onClick={() => invite.create({ registrationId: m.id, memberName: m.fullName })}>
                      ลิงก์
                    </Button>
                  </Tooltip>
                )}
                {canAddRemove && <Button size="small" type="link" danger icon={<DeleteOutlined />} aria-label="ถอนสมาชิก" onClick={() => setRemoveTarget(m)} />}
              </Space>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <Card style={{ marginBottom: 16 }}>
        <Flex justify="space-between" align="flex-start" gap={16} wrap>
          <div style={{ minWidth: 0 }}>
            <Space wrap>
              <Typography.Title level={3} style={{ margin: 0 }}>
                {g.name}
              </Typography.Title>
              <GroupStatusTag status={g.status} />
            </Space>
            <div style={{ marginTop: 4 }}>
              <Typography.Text code copyable>
                {g.groupNo}
              </Typography.Text>{' '}
              <Typography.Text type="secondary">
                {g.participantOrganization.nameTh} {g.participantOrganization.verified && <Tag color="blue">ตรวจสอบองค์กรแล้ว</Tag>}
              </Typography.Text>
            </div>
          </div>
          <Space wrap>
            {coordinator && g.status === 'DRAFT' && (
              <Button type="primary" icon={<SendOutlined />} disabled={g.memberCount < g.settings.minMembers} onClick={() => setSubmitOpen(true)}>
                ส่งกลุ่ม ({g.memberCount} คน)
              </Button>
            )}
            {open && (
              <Button danger icon={<StopOutlined />} onClick={() => setCancelOpen(true)}>
                ยกเลิกกลุ่ม
              </Button>
            )}
          </Space>
        </Flex>
        <Descriptions size="small" column={{ xs: 1, md: 2 }} style={{ marginTop: 16 }}>
          <Descriptions.Item label="กิจกรรม">
            <Link href={`/events/${g.eventCode}`}>{g.eventTitle}</Link>
          </Descriptions.Item>
          <Descriptions.Item label="วันจัด">
            <ThaiDate value={g.eventStartAt} time />
          </Descriptions.Item>
          <Descriptions.Item label="ผู้ประสานงาน">
            {g.coordinator.displayName} · {g.coordinator.email}
            {g.contactPhone ? ` · ${g.contactPhone}` : ''}
          </Descriptions.Item>
          <Descriptions.Item label="จำนวนสมาชิก">
            {g.memberCount} คน (กำหนด {g.settings.minMembers}–{g.settings.maxMembers} คน)
          </Descriptions.Item>
          {g.submittedAt && (
            <Descriptions.Item label="ส่งกลุ่มเมื่อ">
              <ThaiDate value={g.submittedAt} time />
            </Descriptions.Item>
          )}
          {g.status !== 'DRAFT' && open && (
            <Descriptions.Item label="แก้ไขรายชื่อได้ถึง">{g.canChangeMembers ? <ThaiDate value={g.settings.memberChangeCloseAt ?? g.eventStartAt} time /> : 'ปิดแก้ไขแล้ว'}</Descriptions.Item>
          )}
        </Descriptions>
        {g.cancelReason && <Alert type="error" showIcon style={{ marginTop: 12 }} title={`${g.status === 'EXPIRED' ? 'หมดเวลา' : 'ยกเลิก'}: ${g.cancelReason}`} />}
        {coordinator && next && <Alert type="info" showIcon style={{ marginTop: 12 }} title={next} />}
      </Card>

      <Tabs
        items={[
          {
            key: 'members',
            label: `สมาชิก (${g.memberCount})`,
            children: (
              <Card
                extra={
                  canAddRemove && (
                    <Button type="primary" icon={<PlusOutlined />} disabled={g.memberCount >= g.settings.maxMembers} onClick={() => setMemberModal({})}>
                      เพิ่มสมาชิก
                    </Button>
                  )
                }
                title={g.status !== 'DRAFT' && paidLocked && editable ? <Typography.Text type="secondary" style={{ fontWeight: 400, fontSize: 14 }}>ชำระเงินแล้ว — เปลี่ยนตัวสมาชิกได้ แต่เพิ่ม/ถอนไม่ได้</Typography.Text> : undefined}
              >
                <Table rowKey="id" size="small" dataSource={g.members} columns={memberColumns} pagination={false} scroll={{ x: 900 }} locale={{ emptyText: 'ยังไม่มีสมาชิก' }} />
              </Card>
            ),
          },
          ...(coordinator && g.status === 'DRAFT' && g.settings.allowImport
            ? [{ key: 'import', label: 'นำเข้าจาก Excel', children: <Card><GroupImportPanel groupId={g.id} onImported={refresh} /></Card> }]
            : []),
          ...(coordinator && open && g.settings.allowInviteLinks
            ? [{ key: 'invite', label: 'ลิงก์เชิญ', children: <Card><GroupInvitations group={g} onChanged={refresh} /></Card> }]
            : []),
          ...(g.payment
            ? [
                {
                  key: 'payment',
                  label: 'การชำระเงิน',
                  children: (
                    <PaymentPanel
                      order={g.payment}
                      upload={(file, transferredAt) => {
                        const fd = new FormData();
                        if (transferredAt) fd.append('transferredAt', transferredAt);
                        fd.append('file', file);
                        return api.post(`/groups/${g.id}/slip`, fd);
                      }}
                      saveBilling={coordinator ? (b) => api.patch(`/groups/${g.id}/billing`, { billing: b }) : undefined}
                      onChanged={refresh}
                    />
                  ),
                },
              ]
            : []),
          {
            key: 'history',
            label: 'ประวัติการเปลี่ยนแปลง',
            children: (
              <Card>
                <Timeline
                  items={(logs.data ?? []).map((l) => ({
                    content: (
                      <>
                        <strong>{ACTION_LABEL[l.action] ?? l.action}</strong>
                        <div style={{ color: '#6b7280', fontSize: 13 }}>
                          {l.actorName ?? 'ระบบ / สมาชิกผ่านลิงก์'} · <ThaiDate value={l.createdAt} time />
                        </div>
                        {l.reason && <div className="pre-wrap">เหตุผล: {l.reason}</div>}
                      </>
                    ),
                  }))}
                />
              </Card>
            ),
          },
        ]}
      />

      {memberModal && (
        <MemberModal
          group={g}
          member={memberModal.member}
          onClose={() => setMemberModal(null)}
          onSaved={() => {
            setMemberModal(null);
            refresh();
          }}
        />
      )}
      {invite.dialog}

      <ReasonModal
        open={!!removeTarget}
        title={`ถอน ${removeTarget?.fullName ?? ''} ออกจากกลุ่ม`}
        reasonRequired={g.status !== 'DRAFT'}
        note={g.status !== 'DRAFT' ? 'ที่นั่งจะถูกคืน และระบบจะออกใบแจ้งชำระใหม่ตามจำนวนสมาชิกที่เหลือ (กำหนดชำระเดิม)' : undefined}
        loading={remove.isPending}
        onCancel={() => setRemoveTarget(null)}
        onOk={(reason) => remove.mutate({ id: removeTarget!.id, reason })}
      />
      {submitOpen && <SubmitModal group={g} onClose={() => setSubmitOpen(false)} onDone={refresh} />}
      <CancelGroup open={cancelOpen} group={g} reasonRequired={!coordinator} onClose={() => setCancelOpen(false)} onDone={refresh} />
    </>
  );
}

function MemberModal({ group, member, onClose, onSaved }: { group: GroupDetailDto; member?: GroupMemberDto; onClose: () => void; onSaved: () => void }) {
  const msg = useApiMessage();
  const [form] = Form.useForm<MemberValues>();
  const submitted = group.status !== 'DRAFT';
  const save = useMutation({
    mutationFn: (v: MemberValues) =>
      member ? api.put(`/groups/${group.id}/members/${member.id}`, valuesToBody(v)) : api.post(`/groups/${group.id}/members`, valuesToBody(v)),
    onSuccess: () => {
      msg.success(member ? 'บันทึกข้อมูลสมาชิกแล้ว' : 'เพิ่มสมาชิกแล้ว');
      onSaved();
    },
    onError: msg.error,
  });
  return (
    <Modal
      open
      width={720}
      title={member ? (submitted ? 'แก้ไขข้อมูล / เปลี่ยนตัวสมาชิก' : 'แก้ไขข้อมูลสมาชิก') : 'เพิ่มสมาชิก'}
      okText="บันทึก"
      cancelText="ยกเลิก"
      onOk={() => form.submit()}
      onCancel={onClose}
      confirmLoading={save.isPending}
      destroyOnHidden
    >
      {!member && submitted && group.isPaid && <Alert type="info" showIcon style={{ marginBottom: 12 }} title="การเพิ่มสมาชิกหลังส่งกลุ่มจะออกใบแจ้งชำระใหม่ตามยอดรวมใหม่" />}
      <MemberForm
        form={form}
        fields={group.fields}
        participantTypes={group.participantTypes}
        askReason={!!member && submitted}
        lockType={!!member && submitted}
        initialValues={member ? memberToValues(member) : undefined}
        onFinish={(v) => save.mutate(v)}
      />
    </Modal>
  );
}


function SubmitModal({ group, onClose, onDone }: { group: GroupDetailDto; onClose: () => void; onDone: () => void }) {
  const msg = useApiMessage();
  const [agree, setAgree] = useState(false);
  const idem = useRef(newIdempotencyKey());
  const missing = group.fields.filter((f) => f.isRequired);
  const incomplete = group.members.filter((m) => missing.some((f) => !m.answers.some((a) => a.key === f.key && (Array.isArray(a.value) ? a.value.length : a.value))));
  const submit = useMutation({
    mutationFn: () => api.post<GroupDetailDto>(`/groups/${group.id}/submit`, { pdpaAttestation: true }, { headers: { 'Idempotency-Key': idem.current } }),
    onSuccess: (g) => {
      msg.success(g.status === 'CONFIRMED' ? 'ส่งกลุ่มและยืนยันที่นั่งเรียบร้อย' : 'สำรองที่นั่งแล้ว กรุณาชำระเงินตามใบแจ้งชำระรวม');
      onClose();
      onDone();
    },
    onError: (e) => {
      idem.current = newIdempotencyKey();
      msg.error(e);
    },
  });
  return (
    <Modal open title="ส่งกลุ่มและสำรองที่นั่ง" okText="ยืนยันส่งกลุ่ม" cancelText="ยกเลิก" okButtonProps={{ disabled: !agree || incomplete.length > 0 }} confirmLoading={submit.isPending} onOk={() => submit.mutate()} onCancel={onClose}>
      <Typography.Paragraph>
        ระบบจะสำรองที่นั่งให้สมาชิกทั้ง <strong>{group.memberCount} คน</strong> พร้อมกัน — ถ้าที่นั่งคงเหลือไม่พอจะไม่สำรองให้ใครเลย
        {group.isPaid && ' และออกใบแจ้งชำระรวม 1 ใบตามอัตราของแต่ละคน'}
      </Typography.Paragraph>
      {incomplete.length > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          title={`ข้อมูลยังไม่ครบ ${incomplete.length} คน`}
          description={incomplete.map((m) => m.fullName).join(', ')}
        />
      )}
      <Checkbox checked={agree} onChange={(e) => setAgree(e.target.checked)}>
        ข้าพเจ้าในฐานะผู้ประสานงาน ยืนยันว่าได้แจ้งและได้รับความยินยอมจากสมาชิกทุกคนให้มหาวิทยาลัยเก็บรวบรวมและใช้ข้อมูลส่วนบุคคลเพื่อการจัดกิจกรรมนี้ ตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562
      </Checkbox>
    </Modal>
  );
}

function CancelGroup({ open, group, reasonRequired, onClose, onDone }: { open: boolean; group: GroupDetailDto; reasonRequired: boolean; onClose: () => void; onDone: () => void }) {
  const msg = useApiMessage();
  const cancel = useMutation({
    mutationFn: (reason?: string) => api.post(`/groups/${group.id}/cancel`, { reason }),
    onSuccess: () => {
      msg.success('ยกเลิกกลุ่มแล้ว');
      onClose();
      onDone();
    },
    onError: msg.error,
  });
  const paid = group.payment && ['PAID', 'PENDING_VERIFICATION'].includes(group.payment.status);
  return (
    <ReasonModal
      open={open}
      title={`ยกเลิกกลุ่ม ${group.groupNo}`}
      danger
      reasonRequired={reasonRequired}
      note={`สมาชิกทั้ง ${group.memberCount} คนจะถูกยกเลิกและคืนที่นั่ง${paid ? ' — เงินที่ชำระแล้วจะเข้าสู่กระบวนการคืนเงินของมหาวิทยาลัย' : ''}`}
      loading={cancel.isPending}
      onCancel={onClose}
      onOk={(r) => cancel.mutate(r)}
    />
  );
}

function ReasonModal({
  open,
  title,
  note,
  reasonRequired,
  danger,
  loading,
  onCancel,
  onOk,
}: {
  open: boolean;
  title: string;
  note?: string;
  reasonRequired: boolean;
  danger?: boolean;
  loading: boolean;
  onCancel: () => void;
  onOk: (reason?: string) => void;
}) {
  const [form] = Form.useForm<{ reason?: string }>();
  return (
    <Modal open={open} title={title} okText="ยืนยัน" cancelText="ปิด" okButtonProps={{ danger: true, loading }} onCancel={onCancel} onOk={() => form.submit()} destroyOnHidden>
      {note && <Alert type={danger ? 'warning' : 'info'} showIcon style={{ marginBottom: 12 }} title={note} />}
      <Form form={form} layout="vertical" preserve={false} onFinish={(v) => onOk(v.reason?.trim() || undefined)}>
        <Form.Item name="reason" label="เหตุผล" rules={reasonRequired ? [{ required: true, min: 3, message: 'กรุณาระบุเหตุผล' }] : []}>
          <Input.TextArea rows={3} maxLength={1000} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}

