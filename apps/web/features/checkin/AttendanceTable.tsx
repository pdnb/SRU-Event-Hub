'use client';

import { DownloadOutlined, EditOutlined, SearchOutlined } from '@ant-design/icons';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Col, Form, Input, Modal, Row, Select, Statistic, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { ThaiDate } from '@/components/Format';
import { ErrorState } from '@/components/QueryState';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';
import { downloadFile } from '@/services/download';
import { ATTENDANCE_META, type AttendanceStatus, type Schedule } from './types';

interface Row {
  registrationId: string;
  referenceNo: string;
  fullName: string;
  participantType: string;
  affiliation: string | null;
  groupNo: string | null;
  status: AttendanceStatus;
  firstCheckinAt: string | null;
  lastCheckoutAt: string | null;
  isManual: boolean;
  note: string | null;
}
interface Summary {
  confirmed: number;
  present: number;
  late: number;
  excused: number;
  absent: number;
}

/** Attendance per registrant for the whole event or one session (spec §4.9). */
export function AttendanceTable({ eventId, schedules }: { eventId: string; schedules: Schedule[] }) {
  const can = useCan();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const [q, setQ] = useState<{ page: number; perPage: number; search?: string; status?: AttendanceStatus; scheduleId?: string }>({ page: 1, perPage: 20 });
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Row | null>(null);
  const [form] = Form.useForm<{ status: AttendanceStatus; note: string }>();
  const list = useQuery({
    queryKey: ['attendance', eventId, q],
    queryFn: () => api.getPage<Row>(`/events/${eventId}/attendance`, q),
    placeholderData: keepPreviousData,
  });
  const summary = (list.data?.meta as { summary?: Summary } | undefined)?.summary;
  const save = useMutation({
    mutationFn: (v: { status: AttendanceStatus; note: string }) => api.put(`/events/${eventId}/attendance/${editing!.registrationId}`, { ...v, scheduleId: q.scheduleId }),
    onSuccess: () => {
      msg.success('บันทึกการเข้าร่วมแล้ว');
      setEditing(null);
      for (const k of ['attendance', 'checkin-stats']) void qc.invalidateQueries({ queryKey: [k, eventId] });
    },
    onError: msg.error,
  });

  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  return (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {(['present', 'late', 'excused', 'absent'] as const).map((k) => (
          <Col key={k} xs={12} md={6}>
            <Statistic title={{ present: 'เข้าร่วม', late: 'มาสาย', excused: 'ลา', absent: 'ยังไม่มา / ไม่เข้าร่วม' }[k]} value={summary?.[k] ?? 0} suffix={summary ? `/ ${summary.confirmed}` : undefined} />
          </Col>
        ))}
      </Row>
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={8}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="ชื่อ เลขอ้างอิง รหัสนักศึกษา"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (!e.target.value) setQ({ ...q, search: undefined, page: 1 });
            }}
            onPressEnter={() => setQ({ ...q, search: search.trim() || undefined, page: 1 })}
          />
        </Col>
        {schedules.length > 0 && (
          <Col xs={12} md={6}>
            <Select allowClear placeholder="ทั้งกิจกรรม" style={{ width: '100%' }} value={q.scheduleId} onChange={(scheduleId) => setQ({ ...q, scheduleId, page: 1 })} options={schedules.map((s) => ({ value: s.id, label: s.title }))} />
          </Col>
        )}
        <Col xs={12} md={5}>
          <Select allowClear placeholder="สถานะ" style={{ width: '100%' }} value={q.status} onChange={(status) => setQ({ ...q, status, page: 1 })} options={Object.entries(ATTENDANCE_META).map(([value, m]) => ({ value, label: m.label }))} />
        </Col>
        <Col xs={24} md={5} style={{ textAlign: 'right' }}>
          {can('attendance:export') && (
            <Button icon={<DownloadOutlined />} onClick={() => downloadFile(`/events/${eventId}/attendance/export`, 'attendance.xlsx', { scheduleId: q.scheduleId }).catch(msg.error)}>
              ส่งออก Excel
            </Button>
          )}
        </Col>
      </Row>
      <Table<Row>
        rowKey="registrationId"
        size="small"
        loading={list.isFetching}
        dataSource={list.data?.items}
        scroll={{ x: 1000 }}
        pagination={{ current: q.page, pageSize: q.perPage, total: list.data?.meta.total, showTotal: (t) => `ทั้งหมด ${t} คน`, onChange: (page, perPage) => setQ({ ...q, page, perPage }) }}
        columns={[
          { title: 'เลขอ้างอิง', dataIndex: 'referenceNo', width: 160, render: (v) => <Typography.Text code>{v}</Typography.Text> },
          { title: 'ชื่อ-นามสกุล', dataIndex: 'fullName' },
          { title: 'ประเภท', dataIndex: 'participantType', width: 140 },
          { title: 'หน่วยงาน / กลุ่ม', render: (_, r) => [r.affiliation, r.groupNo].filter(Boolean).join(' · ') || '-' },
          { title: 'สถานะ', dataIndex: 'status', width: 170, render: (s: AttendanceStatus, r) => (
            <>
              <Tag color={ATTENDANCE_META[s].color}>{ATTENDANCE_META[s].label}</Tag>
              {r.isManual && <Tag title={r.note ?? undefined}>บันทึกโดยเจ้าหน้าที่</Tag>}
            </>
          ) },
          { title: 'เช็กอิน', dataIndex: 'firstCheckinAt', width: 170, render: (d) => <ThaiDate value={d} time /> },
          { title: 'เช็กเอาต์', dataIndex: 'lastCheckoutAt', width: 170, render: (d) => <ThaiDate value={d} time /> },
          {
            title: '',
            width: 60,
            render: (_, r) =>
              can('attendance:update') && (
                <Button
                  size="small"
                  type="text"
                  icon={<EditOutlined />}
                  aria-label="แก้ไขสถานะการเข้าร่วม"
                  onClick={() => {
                    setEditing(r);
                    form.setFieldsValue({ status: r.status, note: '' });
                  }}
                />
              ),
          },
        ]}
      />
      <Modal open={!!editing} title={editing && `บันทึกการเข้าร่วม: ${editing.fullName}`} okText="บันทึก" cancelText="ยกเลิก" onCancel={() => setEditing(null)} onOk={() => form.submit()} okButtonProps={{ loading: save.isPending }} destroyOnHidden>
        <Typography.Paragraph type="secondary">ใช้กรณีพิเศษ เช่น ลา หรือเข้าร่วมแต่ไม่ได้สแกน — ระบบบันทึกผู้แก้ไขและเหตุผลไว้ (หากภายหลังมีการสแกน QR จริง ผลการสแกนจะแทนที่)</Typography.Paragraph>
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Form.Item name="status" label="สถานะ" rules={[{ required: true }]}>
            <Select options={Object.entries(ATTENDANCE_META).map(([value, m]) => ({ value, label: m.label }))} />
          </Form.Item>
          <Form.Item name="note" label="เหตุผล / หมายเหตุ" rules={[{ required: true, min: 3, message: 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร' }]}>
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
