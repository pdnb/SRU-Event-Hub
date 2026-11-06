'use client';

import { HistoryOutlined, PrinterOutlined, SearchOutlined } from '@ant-design/icons';
import { ApiError } from '@sru/api-client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Col, Flex, Form, Input, Modal, Row, Segmented, Select, Space, Switch, Table, Tag, Timeline, Typography } from 'antd';
import { useState } from 'react';
import { ThaiDate } from '@/components/Format';
import { ErrorState } from '@/components/QueryState';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';
import { printPdf } from './print';
import { MODE_LABEL, type Candidate, type TemplateSummary } from './types';

type Kind = 'registration' | 'personnel';
interface Job {
  id: string;
  itemCount: number;
  reprinted: number;
}

/**
 * Batch printing (spec §4.8.1): pick who to print (filters or selection), choose a template, print.
 * Anyone already printed is a reprint — needs `badge:reprint` and a reason, recorded per badge.
 */
export function BadgePrintPanel({ eventId, templates }: { eventId: string; templates: TemplateSummary[] }) {
  const can = useCan();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const [templateId, setTemplateId] = useState<string | undefined>(templates.find((t) => t.isDefault)?.id ?? templates[0]?.id);
  const [kind, setKind] = useState<Kind>('registration');
  const [q, setQ] = useState<{ page: number; perPage: number; search?: string; participantTypeId?: string; printed?: 'yes' | 'no' }>({ page: 1, perPage: 50 });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmAll, setConfirmAll] = useState(false);
  const [reprint, setReprint] = useState<string[] | null>(null);
  const [history, setHistory] = useState<Candidate | null>(null);
  const [form] = Form.useForm<{ reason: string }>();
  const [allForm] = Form.useForm<{ includePersonnel: boolean }>();

  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api.public.lookups(), staleTime: 600_000 });
  const list = useQuery({
    queryKey: ['badge-candidates', eventId, kind, q],
    queryFn: () => api.getPage<Candidate>(`/events/${eventId}/badges/candidates`, { ...q, kind }),
    placeholderData: keepPreviousData,
  });
  const hist = useQuery({
    queryKey: ['badge-history', history?.id],
    queryFn: () => api.get<{ printNo: number; createdAt: string; job: { mode: string; reason: string | null; requestedBy: { displayName: string } } }[]>(history!.kind === 'registration' ? `/registrations/${history!.id}/badge-history` : `/event-personnel/${history!.id}/badge-history`),
    enabled: !!history,
  });
  const printedTotal = (list.data?.meta as { printedTotal?: number } | undefined)?.printedTotal;

  const done = async (job: Job) => {
    setSelected([]);
    setReprint(null);
    setConfirmAll(false);
    void qc.invalidateQueries({ queryKey: ['badge-candidates', eventId] });
    void qc.invalidateQueries({ queryKey: ['badge-jobs', eventId] });
    const how = await printPdf(`/badge-print-jobs/${job.id}/pdf`);
    msg.success(`สร้างงานพิมพ์ ${job.itemCount} ป้าย${job.reprinted ? ` (พิมพ์ซ้ำ ${job.reprinted})` : ''}${how === 'tab' ? ' — เปิดในแท็บใหม่แล้ว' : ''}`);
  };

  const create = useMutation({
    mutationFn: (body: { mode: string; registrationIds?: string[] | null; personnelIds?: string[] | null; filter?: object; reason?: string }) => api.post<Job>(`/events/${eventId}/badge-print-jobs`, { templateId, ...body }),
    onSuccess: (job) => void done(job).catch(msg.error),
    onError: (e, body) => {
      const ids = body.registrationIds ?? body.personnelIds;
      // Another desk printed meanwhile: offer the reprint (with reason) for the same people.
      if (e instanceof ApiError && e.code === 'ALREADY_PRINTED' && can('badge:reprint') && ids?.length && body.mode !== 'REPRINT') setReprint(ids);
      else msg.error(e);
    },
  });

  const printSelected = (ids = selected) => {
    const rows = list.data?.items.filter((r) => ids.includes(r.id)) ?? [];
    if (rows.some((r) => r.printCount > 0)) {
      if (!can('badge:reprint')) return msg.error(new ApiError(0, 'FORBIDDEN', 'มีรายการที่พิมพ์แล้ว — การพิมพ์ซ้ำต้องได้รับสิทธิ์พิมพ์ซ้ำ'));
      form.resetFields();
      return setReprint(ids);
    }
    create.mutate({ mode: 'BATCH', [kind === 'registration' ? 'registrationIds' : 'personnelIds']: ids });
  };

  if (!templates.length) return <Alert type="info" showIcon title="ยังไม่มีแม่แบบป้ายชื่อ" description="สร้างแม่แบบในแท็บ “แม่แบบป้ายชื่อ” ก่อนพิมพ์" />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;

  return (
    <>
      <Flex justify="space-between" gap={12} wrap style={{ marginBottom: 12 }}>
        <Space wrap>
          <Typography.Text>แม่แบบ:</Typography.Text>
          <Select style={{ minWidth: 260 }} value={templateId} onChange={setTemplateId} options={templates.map((t) => ({ value: t.id, label: `${t.nameTh}${t.isDefault ? ' (ค่าเริ่มต้น)' : ''} · ${t.widthMm}×${t.heightMm} มม.` }))} />
        </Space>
        {can('badge:print') && (
          <Space wrap>
            <Button disabled={!selected.length} icon={<PrinterOutlined />} loading={create.isPending} onClick={() => printSelected()}>
              พิมพ์ที่เลือก ({selected.length})
            </Button>
            <Button type="primary" icon={<PrinterOutlined />} onClick={() => {
              allForm.setFieldsValue({ includePersonnel: true });
              setConfirmAll(true);
            }}>
              พิมพ์ทุกคนที่ยังไม่ได้พิมพ์
            </Button>
          </Space>
        )}
      </Flex>

      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={6}>
          <Segmented
            block
            value={kind}
            onChange={(v) => {
              setKind(v as Kind);
              setSelected([]);
              setQ({ ...q, page: 1, participantTypeId: undefined });
            }}
            options={[
              { value: 'registration', label: 'ผู้ลงทะเบียน' },
              { value: 'personnel', label: 'บุคลากรของงาน' },
            ]}
          />
        </Col>
        <Col xs={24} md={8}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="ชื่อ เลขอ้างอิง เลขที่กลุ่ม"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (!e.target.value) setQ({ ...q, search: undefined, page: 1 });
            }}
            onPressEnter={() => setQ({ ...q, search: search.trim() || undefined, page: 1 })}
          />
        </Col>
        {kind === 'registration' && (
          <Col xs={12} md={5}>
            <Select allowClear placeholder="ประเภทผู้เข้าร่วม" style={{ width: '100%' }} value={q.participantTypeId} onChange={(participantTypeId) => setQ({ ...q, participantTypeId, page: 1 })} options={lookups.data?.participantTypes.map((t) => ({ value: t.id, label: t.nameTh }))} />
          </Col>
        )}
        <Col xs={12} md={5}>
          <Select
            allowClear
            placeholder="การพิมพ์"
            style={{ width: '100%' }}
            value={q.printed}
            onChange={(printed) => setQ({ ...q, printed, page: 1 })}
            options={[
              { value: 'no', label: 'ยังไม่พิมพ์' },
              { value: 'yes', label: 'พิมพ์แล้ว' },
            ]}
          />
        </Col>
      </Row>
      {kind === 'registration' && printedTotal !== undefined && (
        <Typography.Paragraph type="secondary">พิมพ์ป้ายแล้ว {printedTotal} คน (เฉพาะผู้ลงทะเบียนที่ยืนยันแล้ว)</Typography.Paragraph>
      )}

      <Table<Candidate>
        rowKey="id"
        size="small"
        loading={list.isFetching}
        dataSource={list.data?.items}
        rowSelection={can('badge:print') ? { selectedRowKeys: selected, onChange: (k) => setSelected(k as string[]), preserveSelectedRowKeys: true } : undefined}
        scroll={{ x: 900 }}
        pagination={{ current: q.page, pageSize: q.perPage, total: list.data?.meta.total, showTotal: (t) => `ทั้งหมด ${t} รายการ`, onChange: (page, perPage) => setQ({ ...q, page, perPage }) }}
        columns={[
          ...(kind === 'registration' ? [{ title: 'เลขอ้างอิง', dataIndex: 'referenceNo', width: 160, render: (v: string) => <Typography.Text code>{v}</Typography.Text> }] : []),
          { title: 'ชื่อ', dataIndex: 'fullName' },
          { title: kind === 'registration' ? 'ประเภท' : 'บทบาท', dataIndex: 'detail', width: 140 },
          { title: 'หน่วยงาน / กลุ่ม', render: (_, r) => [r.affiliation, r.groupNo].filter(Boolean).join(' · ') || '-' },
          ...(kind === 'registration' ? [{ title: 'เช็กอิน', dataIndex: 'checkedIn', width: 90, render: (c: boolean) => (c ? <Tag color="green">มาแล้ว</Tag> : '-') }] : []),
          {
            title: 'ป้ายชื่อ',
            width: 200,
            render: (_, r) =>
              r.printCount ? (
                <Button size="small" type="link" icon={<HistoryOutlined />} onClick={() => setHistory(r)}>
                  พิมพ์แล้ว {r.printCount} ครั้ง
                </Button>
              ) : (
                <Typography.Text type="secondary">ยังไม่พิมพ์</Typography.Text>
              ),
          },
          {
            title: '',
            width: 100,
            render: (_, r) =>
              can('badge:print') && (r.printCount === 0 || can('badge:reprint')) && (
                <Button size="small" onClick={() => printSelected([r.id])}>
                  {r.printCount ? 'พิมพ์ซ้ำ' : 'พิมพ์'}
                </Button>
              ),
          },
        ]}
      />

      <Modal open={confirmAll} title="พิมพ์ป้ายชื่อทุกคนที่ยังไม่ได้พิมพ์" okText="สร้างงานพิมพ์" cancelText="ยกเลิก" onCancel={() => setConfirmAll(false)} okButtonProps={{ loading: create.isPending }} onOk={() => allForm.submit()} forceRender>
        <Form form={allForm} layout="vertical" onFinish={(v) => create.mutate({ mode: 'BATCH', filter: { includePersonnel: v.includePersonnel, participantTypeIds: q.participantTypeId ? [q.participantTypeId] : undefined } })}>
          <Typography.Paragraph>
            ระบบจะรวมผู้ลงทะเบียนที่ยืนยันแล้วและยังไม่เคยพิมพ์ป้าย{q.participantTypeId ? ` (เฉพาะประเภทที่กรองไว้)` : ''} เรียงตามกลุ่มและชื่อ ครั้งละไม่เกิน 2,000 ป้าย
          </Typography.Paragraph>
          <Form.Item name="includePersonnel" valuePropName="checked" label="รวมบุคลากรของงาน (วิทยากร เจ้าหน้าที่ ฯลฯ) ที่ยังไม่ได้พิมพ์">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={!!reprint} title="พิมพ์ป้ายชื่อซ้ำ" okText="พิมพ์ซ้ำ" cancelText="ยกเลิก" onCancel={() => setReprint(null)} okButtonProps={{ loading: create.isPending }} onOk={() => form.submit()} forceRender>
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} title="ป้ายที่พิมพ์ซ้ำจะมีหมายเลขครั้งที่พิมพ์กำกับ และบันทึกผู้สั่งพิมพ์พร้อมเหตุผล" />
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => create.mutate({ mode: 'REPRINT', [kind === 'registration' ? 'registrationIds' : 'personnelIds']: reprint, reason: v.reason })}
        >
          <Form.Item name="reason" label="เหตุผล" rules={[{ required: true, min: 3, message: 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร' }]}>
            <Input.TextArea rows={3} maxLength={500} showCount placeholder="เช่น ป้ายชำรุด / ทำหาย / ข้อมูลผิดแก้ไขแล้ว" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={!!history} title={history && `ประวัติการพิมพ์ป้าย: ${history.fullName}`} footer={null} onCancel={() => setHistory(null)}>
        <Timeline
          items={(hist.data ?? []).map((h) => ({
            color: h.printNo > 1 ? 'orange' : 'green',
            content: (
              <>
                <strong>ครั้งที่ {h.printNo}</strong> <Tag color={MODE_LABEL[h.job.mode]?.color}>{MODE_LABEL[h.job.mode]?.text}</Tag>
                <div style={{ color: '#6b7280', fontSize: 13 }}>
                  {h.job.requestedBy.displayName} · <ThaiDate value={h.createdAt} time />
                </div>
                {h.job.reason && <div>เหตุผล: {h.job.reason}</div>}
              </>
            ),
          }))}
        />
      </Modal>
    </>
  );
}
