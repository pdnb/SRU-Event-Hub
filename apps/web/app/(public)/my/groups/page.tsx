'use client';

import { EditOutlined, PlusOutlined, UserAddOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GroupSummaryDto, ParticipantOrganizationDto } from '@sru/shared-types';
import { Button, Card, Empty, Form, Input, Modal, Skeleton, Space, Table, Tag, Typography } from 'antd';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Money, ThaiDate } from '@/components/Format';
import { ErrorState } from '@/components/QueryState';
import { StatusTag } from '@/components/StatusTag';
import { ParticipantOrgForm, orgTypeLabel } from '@/features/groups/ParticipantOrgForm';
import { GroupStatusTag } from '@/features/groups/GroupWorkspace';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useMe } from '@/hooks/useMe';
import { api } from '@/services/api';

/** Coordinator home: the groups they registered and the organizations they coordinate. */
export default function MyGroupsPage() {
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const groups = useQuery({ queryKey: ['my-groups'], queryFn: () => api.get<GroupSummaryDto[]>('/me/groups'), enabled: !!me.data });
  const orgs = useQuery({ queryKey: ['my-participant-orgs'], queryFn: () => api.get<ParticipantOrganizationDto[]>('/me/participant-orgs'), enabled: !!me.data });
  const [editing, setEditing] = useState<ParticipantOrganizationDto | null | 'new'>(null);
  const [addTo, setAddTo] = useState<ParticipantOrganizationDto | null>(null);
  const [coForm] = Form.useForm<{ email: string; position?: string }>();
  const addCoordinator = useMutation({
    mutationFn: (v: { email: string; position?: string }) => api.post(`/participant-orgs/${addTo!.id}/coordinators`, v),
    onSuccess: () => {
      msg.success('เพิ่มผู้ประสานงานแล้ว');
      setAddTo(null);
      void qc.invalidateQueries({ queryKey: ['my-participant-orgs'] });
    },
    onError: msg.error,
  });

  useEffect(() => {
    if (me.isError) router.replace('/login?next=/my/groups');
  }, [me.isError, router]);

  return (
    <div className="page-container" style={{ paddingTop: 24, maxWidth: 1100 }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>การลงทะเบียนแบบกลุ่มของฉัน</h1>
      <p style={{ color: '#6b7280', marginTop: 0 }}>
        เริ่มกลุ่มใหม่ได้จากหน้ากิจกรรมที่เปิดรับการลงทะเบียนแบบกลุ่ม (ปุ่ม &quot;เริ่มลงทะเบียนแบบกลุ่ม&quot;)
      </p>

      <Card title="กลุ่มที่ฉันประสานงาน">
        {me.isPending || groups.isPending ? (
          <Skeleton active />
        ) : groups.isError ? (
          <ErrorState error={groups.error} onRetry={() => groups.refetch()} />
        ) : !groups.data.length ? (
          <Empty description="ยังไม่มีกลุ่ม">
            <Link href="/events?tab=open">
              <Button type="primary">ดูกิจกรรมที่เปิดรับสมัคร</Button>
            </Link>
          </Empty>
        ) : (
          <Table
            rowKey="id"
            size="small"
            dataSource={groups.data}
            pagination={false}
            scroll={{ x: 900 }}
            columns={[
              { title: 'เลขที่กลุ่ม', dataIndex: 'groupNo', width: 160, render: (v, g) => <Link href={`/my/groups/${g.id}`}>{v}</Link> },
              { title: 'ชื่อกลุ่ม', dataIndex: 'name', render: (v, g) => <Link href={`/my/groups/${g.id}`}>{v}</Link> },
              { title: 'กิจกรรม', render: (_, g) => <><div>{g.eventTitle}</div><Typography.Text type="secondary" style={{ fontSize: 13 }}><ThaiDate value={g.eventStartAt} /></Typography.Text></> },
              { title: 'สมาชิก', dataIndex: 'memberCount', width: 80, align: 'right' },
              { title: 'ยอดชำระ', width: 150, render: (_, g) => (g.payment ? <Space size={4} direction="vertical"><Money value={g.payment.amount} /><StatusTag status={g.payment.status} /></Space> : '-') },
              { title: 'สถานะ', dataIndex: 'status', width: 150, render: (s) => <GroupStatusTag status={s} /> },
            ]}
          />
        )}
      </Card>

      <Card
        title="องค์กรที่ฉันเป็นผู้ประสานงาน"
        style={{ marginTop: 16 }}
        extra={
          <Button icon={<PlusOutlined />} onClick={() => setEditing('new')}>
            เพิ่มองค์กร
          </Button>
        }
      >
        {orgs.isPending ? (
          <Skeleton active />
        ) : !orgs.data?.length ? (
          <Empty description="ยังไม่มีองค์กร" />
        ) : (
          <Table
            rowKey="id"
            size="small"
            dataSource={orgs.data}
            pagination={false}
            scroll={{ x: 760 }}
            columns={[
              { title: 'ชื่อองค์กร', render: (_, o) => <>{o.nameTh} {o.verified && <Tag color="blue">ตรวจสอบแล้ว</Tag>}</> },
              { title: 'ประเภท', width: 170, render: (_, o) => orgTypeLabel(o.orgType) },
              { title: 'ผู้ประสานงาน', render: (_, o) => o.coordinators.map((c) => c.displayName).join(', ') },
              {
                title: '',
                width: 200,
                render: (_, o) => (
                  <Space size={0}>
                    <Button size="small" type="link" icon={<EditOutlined />} onClick={() => setEditing(o)}>
                      แก้ไข
                    </Button>
                    <Button size="small" type="link" icon={<UserAddOutlined />} onClick={() => setAddTo(o)}>
                      เพิ่มผู้ประสานงาน
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>

      <ParticipantOrgForm
        open={editing !== null}
        org={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void qc.invalidateQueries({ queryKey: ['my-participant-orgs'] });
        }}
      />
      <Modal open={!!addTo} title={`เพิ่มผู้ประสานงาน — ${addTo?.nameTh ?? ''}`} okText="เพิ่ม" cancelText="ยกเลิก" onOk={() => coForm.submit()} onCancel={() => setAddTo(null)} confirmLoading={addCoordinator.isPending} destroyOnHidden>
        <Typography.Paragraph type="secondary">ผู้ประสานงานต้องมีบัญชีผู้ใช้ในระบบแล้ว</Typography.Paragraph>
        <Form form={coForm} layout="vertical" preserve={false} onFinish={(v) => addCoordinator.mutate(v)}>
          <Form.Item name="email" label="อีเมลบัญชีผู้ใช้" rules={[{ required: true, type: 'email', message: 'กรุณากรอกอีเมล' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="position" label="ตำแหน่ง">
            <Input maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
