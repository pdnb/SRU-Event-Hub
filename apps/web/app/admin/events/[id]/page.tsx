'use client';

import { CheckOutlined, EditOutlined, EyeOutlined, RollbackOutlined, SendOutlined, StopOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Descriptions, Dropdown, Flex, Form, Input, Modal, Progress, Tabs, Tag, Timeline, Typography } from 'antd';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Money, ThaiDate, ThaiDateRange } from '@/components/Format';
import { PageHeader } from '@/components/PageHeader';
import { QueryState } from '@/components/QueryState';
import { StatusTag } from '@/components/StatusTag';
import { EDITABLE, POST_APPROVAL_EDITABLE, type AdminEventDto } from '@/features/events/admin-event';
import { FeeChangeDialog, FeeComparison, type PendingFeeChange } from '@/features/events/FeeChange';
import { EventGroupsTab } from '@/features/groups/EventGroupsTab';
import { RegistrationsTable } from '@/features/registration/RegistrationsTable';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan, useMe } from '@/hooks/useMe';
import { api } from '@/services/api';
import dayjs, { DATETIME_FMT } from '@/services/dayjs';
import { DatePicker } from 'antd';

type ApprovalRound = {
  id: string;
  round: number;
  trigger: string;
  status: string;
  currentStepOrder: number | null;
  submittedAt: string;
  submittedBy: { displayName: string };
  workflow: { nameTh: string; steps: { stepOrder: number; nameTh: string; isFinanceReview: boolean }[] };
  actions: { id: string; action: string; comment: string | null; createdAt: string; actor: { displayName: string }; step: { nameTh: string } | null }[];
};

const ACTION_LABEL: Record<string, { text: string; color: string }> = {
  SUBMIT: { text: 'เสนออนุมัติ', color: 'blue' },
  APPROVE: { text: 'อนุมัติ', color: 'green' },
  REJECT: { text: 'ไม่อนุมัติ', color: 'red' },
  RETURN: { text: 'ส่งกลับแก้ไข', color: 'orange' },
  CANCEL: { text: 'ยกเลิก', color: 'gray' },
};

export default function AdminEventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const can = useCan();
  const me = useMe();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const { modal } = App.useApp();
  const [dialog, setDialog] = useState<null | 'reject' | 'return' | 'cancel' | 'reschedule' | 'approve'>(null);
  const [feeDialog, setFeeDialog] = useState(false);
  const [form] = Form.useForm();

  const ev = useQuery({ queryKey: ['admin-event', id], queryFn: () => api.get<AdminEventDto>(`/events/${id}`) });
  const feeChange = useQuery({ queryKey: ['fee-change', id], queryFn: () => api.get<PendingFeeChange | null>(`/events/${id}/fee-change`) });
  const cancelFeeChange = useMutation({
    mutationFn: () => api.post(`/events/${id}/fee-change/cancel`),
    onSuccess: () => {
      msg.success('ถอนคำขอแก้ไขอัตราแล้ว');
      refresh();
    },
    onError: msg.error,
  });
  const approvals = useQuery({ queryKey: ['approval-history', id], queryFn: () => api.get<ApprovalRound[]>(`/events/${id}/approval-history`) });
  const history = useQuery({
    queryKey: ['status-history', id],
    queryFn: () => api.get<{ id: string; fromStatus: string | null; toStatus: string; reason: string | null; createdAt: string; changedBy: { displayName: string } | null }[]>(`/events/${id}/status-history`),
  });

  const refresh = () => {
    for (const k of ['admin-event', 'approval-history', 'status-history', 'fee-change']) void qc.invalidateQueries({ queryKey: [k, id] });
    void qc.invalidateQueries({ queryKey: ['admin-events'] });
    void qc.invalidateQueries({ queryKey: ['approvals-pending'] });
  };
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: object }) => api.post(`/events/${id}/${path}`, body),
    onSuccess: (_d, v) => {
      msg.success('ดำเนินการเรียบร้อย');
      setDialog(null);
      form.resetFields();
      if (v.path === 'delete') router.push('/admin/events');
      refresh();
    },
    onError: msg.error,
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/events/${id}`),
    onSuccess: () => {
      msg.success('ลบฉบับร่างแล้ว');
      router.push('/admin/events');
    },
    onError: msg.error,
  });

  const confirm = (title: string, path: string, content?: string) =>
    modal.confirm({ title, content, okText: 'ยืนยัน', cancelText: 'ยกเลิก', onOk: () => action.mutateAsync({ path }) });

  return (
    <QueryState query={ev}>
      {(e) => {
        const pending = approvals.data?.find((r) => r.status === 'PENDING');
        const currentStep = pending?.workflow.steps.find((s) => s.stepOrder === pending.currentStepOrder);
        const isProposer = me.data?.id === e.ownerUserId;
        const canEdit = can('event:update') && (EDITABLE.includes(e.status) || POST_APPROVAL_EDITABLE.includes(e.status));
        const lifecycle: { key: string; label: string; show: boolean; onClick: () => void }[] = [
          { key: 'publish', label: 'เผยแพร่', show: e.status === 'APPROVED', onClick: () => confirm('เผยแพร่กิจกรรมนี้สู่สาธารณะ?', 'publish') },
          { key: 'open', label: 'เปิดรับสมัครทันที', show: ['PUBLISHED', 'REGISTRATION_CLOSED'].includes(e.status), onClick: () => confirm('เปิดรับสมัครทันที?', 'open-registration') },
          { key: 'close', label: 'ปิดรับสมัคร', show: e.status === 'REGISTRATION_OPEN', onClick: () => confirm('ปิดรับสมัคร?', 'close-registration') },
          { key: 'start', label: 'เริ่มดำเนินกิจกรรม', show: ['PUBLISHED', 'REGISTRATION_CLOSED'].includes(e.status), onClick: () => confirm('เปลี่ยนสถานะเป็นกำลังดำเนินการ?', 'start') },
          { key: 'complete', label: 'ปิดกิจกรรม (เสร็จสิ้น)', show: e.status === 'IN_PROGRESS', onClick: () => confirm('ปิดกิจกรรม?', 'complete') },
          { key: 'reschedule', label: 'เลื่อนกำหนดการ', show: POST_APPROVAL_EDITABLE.includes(e.status), onClick: () => setDialog('reschedule') },
          { key: 'fee-change', label: 'ขอแก้ไขอัตราค่าลงทะเบียน', show: POST_APPROVAL_EDITABLE.includes(e.status) && !pending, onClick: () => setFeeDialog(true) },
        ].filter((a) => a.show && can('event:update'));

        return (
          <>
            <PageHeader
              title={e.titleTh}
              description={
                <Flex gap={8} align="center" wrap>
                  <Typography.Text code>{e.code}</Typography.Text>
                  <StatusTag status={e.status} />
                  <span>อนุมัติ:</span>
                  <StatusTag status={e.approvalStatus} />
                </Flex>
              }
              breadcrumb={[{ title: 'จัดการกิจกรรม', href: '/admin/events' }, { title: e.code }]}
              actions={
                <>
                  {POST_APPROVAL_EDITABLE.includes(e.status) && e.status !== 'APPROVED' && (
                    <Link href={`/events/${e.code}`} target="_blank">
                      <Button icon={<EyeOutlined />}>ดูหน้าสาธารณะ</Button>
                    </Link>
                  )}
                  {canEdit && (
                    <Link href={`/admin/events/${id}/edit`}>
                      <Button icon={<EditOutlined />}>แก้ไข</Button>
                    </Link>
                  )}
                  {EDITABLE.includes(e.status) && can('event:update') && (
                    <Button type="primary" icon={<SendOutlined />} onClick={() => confirm('เสนออนุมัติกิจกรรม?', 'submit', 'เมื่อเสนอแล้วจะแก้ไขไม่ได้จนกว่าจะได้รับผลการพิจารณา')}>
                      เสนออนุมัติ
                    </Button>
                  )}
                  {lifecycle.length > 0 && (
                    <Dropdown menu={{ items: lifecycle.map((a) => ({ key: a.key, label: a.label, onClick: a.onClick })) }}>
                      <Button type={e.status === 'APPROVED' ? 'primary' : 'default'}>ดำเนินการ</Button>
                    </Dropdown>
                  )}
                  {e.status === 'DRAFT' && can('event:delete') && (
                    <Button danger onClick={() => modal.confirm({ title: 'ลบฉบับร่างนี้?', okType: 'danger', okText: 'ลบ', cancelText: 'ยกเลิก', onOk: () => remove.mutateAsync() })}>
                      ลบฉบับร่าง
                    </Button>
                  )}
                  {!['DRAFT', 'COMPLETED', 'CANCELLED'].includes(e.status) && can('event:delete') && (
                    <Button danger icon={<StopOutlined />} onClick={() => setDialog('cancel')}>
                      ยกเลิกกิจกรรม
                    </Button>
                  )}
                </>
              }
            />

            {pending && currentStep && (
              <Alert
                style={{ marginBottom: 16 }}
                type="warning"
                showIcon
                title={`${pending.trigger === 'FEE_CHANGE' ? 'คำขอแก้ไขอัตราค่าลงทะเบียน ' : ''}รอพิจารณา: ${currentStep.nameTh}`}
                description={
                  <>
                    <div>
                      เสนอโดย {pending.submittedBy.displayName} เมื่อ <ThaiDate value={pending.submittedAt} time />
                      {pending.trigger === 'FEE_CHANGE' && ' — ระหว่างนี้ยังใช้อัตราเดิม'}
                    </div>
                    {pending.trigger === 'FEE_CHANGE' && feeChange.data && (
                      <div style={{ marginTop: 8 }}>
                        <FeeComparison view={feeChange.data} />
                        {can('event:update') && (
                          <Button size="small" style={{ marginTop: 8 }} loading={cancelFeeChange.isPending} onClick={() => modal.confirm({ title: 'ถอนคำขอแก้ไขอัตรา?', okText: 'ถอนคำขอ', cancelText: 'ยกเลิก', onOk: () => cancelFeeChange.mutateAsync() })}>
                            ถอนคำขอ
                          </Button>
                        )}
                      </div>
                    )}
                  </>
                }
                action={
                  can('approval:approve') &&
                  !isProposer && (
                    <Flex vertical gap={6}>
                      <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => setDialog('approve')}>
                        อนุมัติ
                      </Button>
                      <Button size="small" icon={<RollbackOutlined />} onClick={() => setDialog('return')}>
                        ส่งกลับแก้ไข
                      </Button>
                      <Button size="small" danger onClick={() => setDialog('reject')}>
                        ไม่อนุมัติ
                      </Button>
                    </Flex>
                  )
                }
              />
            )}
            {e.status === 'CANCELLED' && <Alert style={{ marginBottom: 16 }} type="error" showIcon title="กิจกรรมถูกยกเลิก" description={e.cancelReason} />}

            <Tabs
              items={[
                {
                  key: 'info',
                  label: 'ข้อมูลกิจกรรม',
                  children: (
                    <Card>
                      <Descriptions bordered column={{ xs: 1, md: 2 }} size="small">
                        <Descriptions.Item label="หน่วยงานผู้จัด">{e.organizationName}</Descriptions.Item>
                        <Descriptions.Item label="ผู้รับผิดชอบ">{e.owner.displayName}</Descriptions.Item>
                        <Descriptions.Item label="ประเภท / หมวดหมู่">{[e.eventTypeName, e.categoryName].filter(Boolean).join(' / ') || '-'}</Descriptions.Item>
                        <Descriptions.Item label="วันเวลา">
                          <ThaiDateRange start={e.startAt} end={e.endAt} />
                        </Descriptions.Item>
                        <Descriptions.Item label="เปิดรับสมัคร">
                          <ThaiDate value={e.registrationOpenAt} time /> – <ThaiDate value={e.registrationCloseAt} time />
                        </Descriptions.Item>
                        <Descriptions.Item label="สถานที่">{e.venueText ?? '-'}</Descriptions.Item>
                        <Descriptions.Item label="ที่นั่ง">
                          {e.capacity ? <Progress percent={Math.round((e.seatsTaken / e.capacity) * 100)} format={() => `${e.seatsTaken}/${e.capacity}`} style={{ maxWidth: 260 }} /> : `${e.seatsTaken} (ไม่จำกัด)`}
                        </Descriptions.Item>
                        <Descriptions.Item label="งบประมาณ">
                          <Money value={e.budget} />
                        </Descriptions.Item>
                        <Descriptions.Item label="การรับสมัคร" span={2}>
                          <Flex gap={4} wrap>
                            {e.allowGuestRegistration && <Tag>รับบุคคลภายนอกโดยไม่ต้องเข้าสู่ระบบ</Tag>}
                            {e.allowWaitlist && <Tag>มีรายชื่อสำรอง</Tag>}
                            {e.allowSelfCancel && <Tag>ยกเลิกเองได้</Tag>}
                            {e.participantTypes.map((p) => (
                              <Tag color="blue" key={p.id}>
                                {p.nameTh}
                              </Tag>
                            ))}
                          </Flex>
                        </Descriptions.Item>
                        <Descriptions.Item label="รายละเอียด" span={2}>
                          <div className="pre-wrap">{e.description ?? '-'}</div>
                        </Descriptions.Item>
                        <Descriptions.Item label="แท็ก" span={2}>
                          {e.tags.length ? e.tags.map((t) => <Tag key={t}>{t}</Tag>) : '-'}
                        </Descriptions.Item>
                      </Descriptions>
                    </Card>
                  ),
                },
                ...(can('registration:view') ? [{ key: 'reg', label: `ผู้ลงทะเบียน (${e.seatsTaken})`, children: <Card><RegistrationsTable eventId={id} /></Card> }] : []),
                ...(can('group:view') ? [{ key: 'groups', label: 'ลงทะเบียนแบบกลุ่ม', children: <EventGroupsTab eventId={id} startAt={e.startAt} capacity={e.capacity} /> }] : []),
                {
                  key: 'approval',
                  label: 'ประวัติการอนุมัติ',
                  children: (
                    <Card>
                      {!approvals.data?.length ? (
                        <Typography.Text type="secondary">ยังไม่เคยเสนออนุมัติ</Typography.Text>
                      ) : (
                        approvals.data.map((r) => (
                          <div key={r.id} style={{ marginBottom: 24 }}>
                            <Typography.Title level={5}>
                              รอบที่ {r.round} · {r.trigger === 'FEE_CHANGE' ? 'ขอแก้ไขอัตราค่าลงทะเบียน · ' : ''}
                              {r.workflow.nameTh} <StatusTag status={r.status} />
                            </Typography.Title>
                            <Timeline
                              items={r.actions.map((a) => ({
                                color: ACTION_LABEL[a.action]?.color,
                                content: (
                                  <>
                                    <strong>{ACTION_LABEL[a.action]?.text ?? a.action}</strong>
                                    {a.step && ` — ${a.step.nameTh}`}
                                    <div style={{ color: '#6b7280', fontSize: 13 }}>
                                      {a.actor.displayName} · <ThaiDate value={a.createdAt} time />
                                    </div>
                                    {a.comment && <div className="pre-wrap">“{a.comment}”</div>}
                                  </>
                                ),
                              }))}
                            />
                          </div>
                        ))
                      )}
                    </Card>
                  ),
                },
                {
                  key: 'history',
                  label: 'ประวัติสถานะ',
                  children: (
                    <Card>
                      <Timeline
                        items={(history.data ?? []).map((h) => ({
                          content: (
                            <>
                              {h.fromStatus && <StatusTag status={h.fromStatus} />}→ <StatusTag status={h.toStatus} />
                              <div style={{ color: '#6b7280', fontSize: 13 }}>
                                {h.changedBy?.displayName ?? 'ระบบ'} · <ThaiDate value={h.createdAt} time />
                              </div>
                              {h.reason && <div className="pre-wrap">{h.reason}</div>}
                            </>
                          ),
                        }))}
                      />
                    </Card>
                  ),
                },
              ]}
            />

            {feeDialog && <FeeChangeDialog event={e} open={feeDialog} onClose={() => setFeeDialog(false)} onDone={refresh} />}

            <Modal
              open={dialog !== null}
              title={{ approve: 'อนุมัติ', reject: 'ไม่อนุมัติ', return: 'ส่งกลับแก้ไข', cancel: 'ยกเลิกกิจกรรม', reschedule: 'เลื่อนกำหนดการ' }[dialog ?? 'approve']}
              okText="ยืนยัน"
              cancelText="ปิด"
              okButtonProps={{ danger: dialog === 'reject' || dialog === 'cancel', loading: action.isPending }}
              onCancel={() => setDialog(null)}
              onOk={() => form.submit()}
              destroyOnHidden
            >
              {dialog === 'cancel' && <Alert type="warning" showIcon style={{ marginBottom: 12 }} title="การลงทะเบียนที่ยังใช้งานอยู่ทั้งหมดจะถูกยกเลิก" />}
              <Form
                form={form}
                layout="vertical"
                preserve={false}
                onFinish={(v: { comment?: string; reason?: string; range?: [dayjs.Dayjs, dayjs.Dayjs]; venueText?: string }) => {
                  if (dialog === 'approve') action.mutate({ path: 'approve', body: { comment: v.comment } });
                  if (dialog === 'reject') action.mutate({ path: 'reject', body: { comment: v.comment } });
                  if (dialog === 'return') action.mutate({ path: 'return', body: { comment: v.comment } });
                  if (dialog === 'cancel') action.mutate({ path: 'cancel', body: { reason: v.reason } });
                  if (dialog === 'reschedule')
                    action.mutate({ path: 'reschedule', body: { startAt: v.range![0].toISOString(), endAt: v.range![1].toISOString(), venueText: v.venueText || undefined, reason: v.reason } });
                }}
              >
                {(dialog === 'approve' || dialog === 'reject' || dialog === 'return') && (
                  <Form.Item name="comment" label="ความเห็น / เหตุผล" rules={dialog === 'approve' ? [] : [{ required: true, min: 3, message: 'กรุณาระบุเหตุผล' }]}>
                    <Input.TextArea rows={4} maxLength={2000} showCount />
                  </Form.Item>
                )}
                {dialog === 'reschedule' && (
                  <>
                    <Form.Item name="range" label="วันเวลาใหม่" rules={[{ required: true, message: 'กรุณาระบุวันเวลา' }]} initialValue={[dayjs(e.startAt), dayjs(e.endAt)]}>
                      <DatePicker.RangePicker showTime={{ format: 'HH:mm' }} format={DATETIME_FMT} style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item name="venueText" label="สถานที่ (ถ้าเปลี่ยน)">
                      <Input maxLength={500} />
                    </Form.Item>
                  </>
                )}
                {(dialog === 'cancel' || dialog === 'reschedule') && (
                  <Form.Item name="reason" label="เหตุผล" rules={[{ required: true, min: 5, message: 'กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร' }]}>
                    <Input.TextArea rows={3} maxLength={1000} showCount />
                  </Form.Item>
                )}
              </Form>
            </Modal>
          </>
        );
      }}
    </QueryState>
  );
}
