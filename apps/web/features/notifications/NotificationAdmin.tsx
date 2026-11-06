'use client';

import { EditOutlined, RedoOutlined, SearchOutlined } from '@ant-design/icons';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Checkbox, Flex, Form, Input, Modal, Segmented, Space, Statistic, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { ThaiDate } from '@/components/Format';
import { ErrorState, QueryState } from '@/components/QueryState';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';

interface LogRow {
  id: string;
  channel: 'EMAIL' | 'LINE';
  templateCode: string;
  recipient: string;
  subject: string | null;
  status: 'QUEUED' | 'SENT' | 'FAILED';
  error: string | null;
  attempts: number;
  nextAttemptAt: string;
  sentAt: string | null;
  createdAt: string;
}
interface TemplateRow {
  code: string;
  defaults: { title: string; body: string; emailSubject?: string; emailBody?: string };
  overrides: { channel: 'IN_APP' | 'EMAIL' | 'LINE'; subject: string | null; body: string; isActive: boolean }[];
}
const STATUS = { QUEUED: { color: 'blue', label: 'รอส่ง' }, SENT: { color: 'green', label: 'ส่งแล้ว' }, FAILED: { color: 'red', label: 'ล้มเหลว' } } as const;
const CHANNEL = { IN_APP: 'ในระบบ', EMAIL: 'อีเมล', LINE: 'LINE' } as const;

export function NotificationLogs() {
  const can = useCan();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const [q, setQ] = useState<{ page: number; perPage: number; status?: string; channel?: string; search?: string }>({ page: 1, perPage: 20 });
  const [search, setSearch] = useState('');
  const list = useQuery({ queryKey: ['notification-logs', q], queryFn: () => api.getPage<LogRow>('/notification-logs', q), placeholderData: keepPreviousData, refetchInterval: 30_000 });
  const counts = (list.data?.meta as { counts?: Record<string, number> } | undefined)?.counts ?? {};
  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/notification-logs/${id}/retry`),
    onSuccess: () => {
      msg.success('ส่งเข้าคิวใหม่แล้ว');
      void qc.invalidateQueries({ queryKey: ['notification-logs'] });
    },
    onError: msg.error,
  });
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;

  return (
    <Card>
      <Flex gap={32} wrap style={{ marginBottom: 16 }}>
        <Statistic title="รอส่ง" value={counts.QUEUED ?? 0} />
        <Statistic title="ส่งแล้ว" value={counts.SENT ?? 0} />
        <Statistic title="ล้มเหลว" value={counts.FAILED ?? 0} valueStyle={counts.FAILED ? { color: '#dc2626' } : undefined} />
      </Flex>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input allowClear prefix={<SearchOutlined />} placeholder="ผู้รับ / รหัสแม่แบบ / หัวเรื่อง" value={search} onChange={(e) => setSearch(e.target.value)} onPressEnter={() => setQ({ ...q, page: 1, search: search.trim() || undefined })} style={{ width: 260 }} />
        <Segmented value={q.status ?? 'all'} onChange={(v) => setQ({ ...q, page: 1, status: v === 'all' ? undefined : String(v) })} options={[{ value: 'all', label: 'ทุกสถานะ' }, ...Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))]} />
        <Segmented value={q.channel ?? 'all'} onChange={(v) => setQ({ ...q, page: 1, channel: v === 'all' ? undefined : String(v) })} options={[{ value: 'all', label: 'ทุกช่องทาง' }, { value: 'EMAIL', label: 'อีเมล' }, { value: 'LINE', label: 'LINE' }]} />
      </Space>
      <Table<LogRow>
        rowKey="id"
        size="middle"
        loading={list.isFetching}
        dataSource={list.data?.items ?? []}
        scroll={{ x: 960 }}
        pagination={{ current: q.page, pageSize: q.perPage, total: list.data?.meta.total ?? 0, onChange: (page, perPage) => setQ({ ...q, page, perPage }) }}
        columns={[
          { title: 'เวลา', width: 150, render: (_, r) => <ThaiDate value={r.createdAt} time /> },
          { title: 'ช่องทาง', width: 80, render: (_, r) => CHANNEL[r.channel] },
          { title: 'ผู้รับ', width: 220, dataIndex: 'recipient', ellipsis: true },
          { title: 'เรื่อง', render: (_, r) => (<><div>{r.subject ?? '-'}</div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.templateCode}</Typography.Text></>) },
          {
            title: 'สถานะ',
            width: 200,
            render: (_, r) => (
              <>
                <Tag color={STATUS[r.status].color}>{STATUS[r.status].label}</Tag>
                <span style={{ fontSize: 12, color: '#6b7280' }}>ครั้งที่ {r.attempts}</span>
                {r.error && <div style={{ fontSize: 12, color: r.status === 'SENT' ? '#6b7280' : '#dc2626' }}>{r.error}</div>}
              </>
            ),
          },
          { title: '', width: 90, render: (_, r) => r.status === 'FAILED' && can('system_setting:update') && <Button size="small" icon={<RedoOutlined />} loading={retry.isPending && retry.variables === r.id} onClick={() => retry.mutate(r.id)}>ส่งใหม่</Button> },
        ]}
      />
    </Card>
  );
}

export function NotificationTemplates() {
  const can = useCan();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const list = useQuery({ queryKey: ['notification-templates'], queryFn: () => api.get<TemplateRow[]>('/notification-templates') });
  const [editing, setEditing] = useState<{ code: string; channel: keyof typeof CHANNEL } | null>(null);
  const [form] = Form.useForm<{ subject: string; body: string; isActive: boolean }>();
  const save = useMutation({
    mutationFn: (v: { subject: string; body: string; isActive: boolean }) => api.put(`/notification-templates/${editing!.code}/${editing!.channel}`, v),
    onSuccess: () => {
      msg.success('บันทึกแม่แบบแล้ว (มีผลภายใน 1 นาที)');
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['notification-templates'] });
    },
    onError: msg.error,
  });
  const open = (t: TemplateRow, channel: keyof typeof CHANNEL) => {
    const o = t.overrides.find((x) => x.channel === channel);
    const d = t.defaults;
    form.setFieldsValue(
      o
        ? { subject: o.subject ?? '', body: o.body, isActive: o.isActive }
        : { subject: channel === 'EMAIL' ? (d.emailSubject ?? d.title) : channel === 'IN_APP' ? d.title : '', body: channel === 'EMAIL' ? (d.emailBody ?? d.body) : d.body, isActive: true },
    );
    setEditing({ code: t.code, channel });
  };

  return (
    <QueryState query={list}>
      {(rows) => (
        <Card>
          <Typography.Paragraph type="secondary">
            ตัวแปรที่ใช้ได้ เช่น {'{name} {eventTitle} {eventCode} {eventDate} {venue} {referenceNo} {reason} {link}'} — ไม่แก้ไข = ใช้ข้อความมาตรฐาน
          </Typography.Paragraph>
          <Table<TemplateRow>
            rowKey="code"
            size="middle"
            pagination={false}
            dataSource={rows}
            scroll={{ x: 800 }}
            columns={[
              { title: 'รหัส', dataIndex: 'code', width: 240 },
              { title: 'ข้อความมาตรฐาน', render: (_, t) => (<><div style={{ fontWeight: 600 }}>{t.defaults.title}</div><div style={{ fontSize: 13, color: '#6b7280' }}>{t.defaults.body}</div></>) },
              {
                title: 'ปรับแต่ง',
                width: 260,
                render: (_, t) => (
                  <Space wrap>
                    {(Object.keys(CHANNEL) as (keyof typeof CHANNEL)[]).map((ch) => {
                      const o = t.overrides.find((x) => x.channel === ch);
                      return (
                        <Button key={ch} size="small" type={o?.isActive ? 'primary' : 'default'} icon={<EditOutlined />} disabled={!can('system_setting:update')} onClick={() => open(t, ch)}>
                          {CHANNEL[ch]}
                        </Button>
                      );
                    })}
                  </Space>
                ),
              },
            ]}
          />
          <Modal open={!!editing} title={editing ? `${editing.code} · ${CHANNEL[editing.channel]}` : ''} okText="บันทึก" cancelText="ยกเลิก" onCancel={() => setEditing(null)} onOk={() => form.submit()} okButtonProps={{ loading: save.isPending }} width={640} forceRender>
            <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
              {editing?.channel !== 'LINE' && (
                <Form.Item name="subject" label={editing?.channel === 'EMAIL' ? 'หัวเรื่องอีเมล' : 'หัวข้อ'}>
                  <Input maxLength={300} />
                </Form.Item>
              )}
              <Form.Item name="body" label="ข้อความ" rules={[{ required: true, message: 'กรุณากรอกข้อความ' }]}>
                <Input.TextArea rows={editing?.channel === 'EMAIL' ? 8 : 4} maxLength={5000} />
              </Form.Item>
              <Form.Item name="isActive" valuePropName="checked">
                <Checkbox>ใช้ข้อความที่ปรับแต่งนี้ (ไม่เลือก = กลับไปใช้ข้อความมาตรฐาน)</Checkbox>
              </Form.Item>
            </Form>
          </Modal>
        </Card>
      )}
    </QueryState>
  );
}
