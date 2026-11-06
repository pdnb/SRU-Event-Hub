'use client';

import { CheckCircleTwoTone, SafetyCertificateOutlined, SearchOutlined } from '@ant-design/icons';
import { ApiError } from '@sru/api-client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Col, Empty, Flex, Form, Input, Modal, Row, Segmented, Select, Space, Statistic, Table, Tag, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { ThaiDate } from '@/components/Format';
import { ErrorState } from '@/components/QueryState';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';
import { rulesText } from './CertificateTemplates';
import { ATTENDANCE_LABEL, type Candidate, type CertTemplate } from './types';

type Filter = 'all' | 'eligible' | 'ineligible' | 'issued' | 'not_issued';
interface Summary {
  total: number;
  eligible: number;
  issued: number;
  pending: number;
}

/** Who qualifies for a template, why not, and issuing (all eligible / selected / override). */
export function CertificateIssuePanel({ eventId, templates, eventStarted }: { eventId: string; templates: CertTemplate[]; eventStarted: boolean }) {
  const can = useCan();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const [templateId, setTemplateId] = useState(templates[0]?.id);
  const [q, setQ] = useState<{ page: number; perPage: number; search?: string; filter: Filter }>({ page: 1, perPage: 20, filter: 'all' });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [override, setOverride] = useState<string[] | null>(null);
  const [form] = Form.useForm<{ reason: string }>();
  const template = templates.find((t) => t.id === templateId);

  const list = useQuery({
    queryKey: ['certificate-candidates', eventId, templateId, q],
    queryFn: () => api.getPage<Candidate>(`/events/${eventId}/certificates/candidates`, { templateId, ...q, filter: q.filter === 'all' ? undefined : q.filter }),
    enabled: !!templateId,
    placeholderData: keepPreviousData,
  });
  const summary = (list.data?.meta as { summary?: Summary } | undefined)?.summary;
  const refresh = () => {
    setSelected([]);
    for (const k of ['certificate-candidates', 'certificates', 'certificate-templates']) void qc.invalidateQueries({ queryKey: [k, eventId] });
  };
  const issue = useMutation({
    mutationFn: (body: { ids?: string[]; allEligible?: boolean; overrideReason?: string }) => api.post<{ issued: number; skipped: number }>(`/events/${eventId}/certificates/issue`, { templateId, ...body }),
    onSuccess: (r) => {
      msg.success(r.issued ? `ออกเกียรติบัตรแล้ว ${r.issued} ฉบับ${r.skipped ? ` (ข้าม ${r.skipped} รายการที่มีอยู่แล้ว)` : ''}` : 'ไม่มีรายการที่ต้องออกเพิ่ม');
      setOverride(null);
      refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'NOT_ELIGIBLE' && can('certificate:update')) {
        const ids = ((e.details as { ineligible?: { id: string }[] })?.ineligible ?? []).map((x) => x.id);
        form.resetFields();
        setOverride(ids.length ? selected : null);
      }
      msg.error(e);
    },
  });

  if (!templates.length) return <Empty description="ยังไม่มีแม่แบบเกียรติบัตร — สร้างที่แท็บ “แม่แบบ” ก่อน" />;

  return (
    <>
      <Flex gap={12} wrap align="center" style={{ marginBottom: 16 }}>
        <Select
          style={{ minWidth: 280 }}
          value={templateId}
          onChange={(v) => {
            setTemplateId(v);
            setSelected([]);
            setQ((x) => ({ ...x, page: 1 }));
          }}
          options={templates.map((t) => ({ value: t.id, label: t.nameTh }))}
        />
        {template && <Typography.Text type="secondary">เกณฑ์: {rulesText(template)}</Typography.Text>}
      </Flex>
      {!eventStarted && <Alert type="info" showIcon title="ออกเกียรติบัตรได้เมื่อกิจกรรมเริ่มแล้ว" style={{ marginBottom: 16 }} />}
      {summary && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col xs={12} md={6}>
            <Statistic title="ทั้งหมด" value={summary.total} />
          </Col>
          <Col xs={12} md={6}>
            <Statistic title="ผ่านเกณฑ์" value={summary.eligible} />
          </Col>
          <Col xs={12} md={6}>
            <Statistic title="ออกแล้ว" value={summary.issued} />
          </Col>
          <Col xs={12} md={6}>
            <Statistic title="ผ่านเกณฑ์ รอออก" value={summary.pending} valueStyle={summary.pending ? { color: '#1f3a8a' } : undefined} />
          </Col>
        </Row>
      )}
      <Flex justify="space-between" gap={12} wrap style={{ marginBottom: 12 }}>
        <Space wrap>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="ชื่อ / เลขอ้างอิง / เลขที่เกียรติบัตร"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onPressEnter={() => setQ((x) => ({ ...x, page: 1, search: search.trim() || undefined }))}
            style={{ width: 280 }}
          />
          <Segmented
            value={q.filter}
            onChange={(filter) => setQ((x) => ({ ...x, page: 1, filter: filter as Filter }))}
            options={[
              { value: 'all', label: 'ทั้งหมด' },
              { value: 'eligible', label: 'ผ่านเกณฑ์' },
              { value: 'ineligible', label: 'ไม่ผ่าน' },
              { value: 'not_issued', label: 'ยังไม่ได้รับ' },
              { value: 'issued', label: 'ได้รับแล้ว' },
            ]}
          />
        </Space>
        {can('certificate:create') && (
          <Space wrap>
            <Button disabled={!selected.length || !eventStarted} loading={issue.isPending} onClick={() => issue.mutate({ ids: selected })}>
              ออกให้ที่เลือก ({selected.length})
            </Button>
            <Button type="primary" icon={<SafetyCertificateOutlined />} disabled={!summary?.pending || !eventStarted} loading={issue.isPending} onClick={() => issue.mutate({ allEligible: true })}>
              ออกให้ทุกคนที่ผ่านเกณฑ์ ({summary?.pending ?? 0})
            </Button>
          </Space>
        )}
      </Flex>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <Table<Candidate>
          rowKey="id"
          size="middle"
          loading={list.isFetching}
          dataSource={list.data?.items ?? []}
          scroll={{ x: 900 }}
          rowSelection={can('certificate:create') ? { selectedRowKeys: selected, onChange: (k) => setSelected(k as string[]), getCheckboxProps: (c) => ({ disabled: !!c.certificate }) } : undefined}
          pagination={{ current: q.page, pageSize: q.perPage, total: list.data?.meta.total ?? 0, showSizeChanger: true, onChange: (page, perPage) => setQ((x) => ({ ...x, page, perPage })) }}
          columns={[
            {
              title: 'ชื่อ',
              render: (_, c) => (
                <>
                  <div>{c.fullName}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {[c.referenceNo, c.detail, c.affiliation].filter(Boolean).join(' · ')}
                  </Typography.Text>
                </>
              ),
            },
            ...(template?.audience === 'PARTICIPANT'
              ? [
                  { title: 'การเข้าร่วม', width: 110, render: (_: unknown, c: Candidate) => (c.attendance ? ATTENDANCE_LABEL[c.attendance] : <Typography.Text type="secondary">ยังไม่มา</Typography.Text>) },
                  { title: 'ช่วงกิจกรรม', width: 100, render: (_: unknown, c: Candidate) => c.sessions ?? '-' },
                ]
              : []),
            {
              title: 'เกณฑ์',
              width: 260,
              render: (_, c) =>
                c.eligibility.eligible ? (
                  <Tag color="green">ผ่านเกณฑ์</Tag>
                ) : (
                  <Tooltip title={c.eligibility.reasons.join(' · ')}>
                    <Tag color="orange">ไม่ผ่าน</Tag>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {c.eligibility.reasons[0]}
                      {c.eligibility.reasons.length > 1 ? ` (+${c.eligibility.reasons.length - 1})` : ''}
                    </Typography.Text>
                  </Tooltip>
                ),
            },
            {
              title: 'เกียรติบัตร',
              width: 200,
              render: (_, c) =>
                c.certificate ? (
                  <Space size={4}>
                    <CheckCircleTwoTone twoToneColor="#16a34a" />
                    <span>
                      {c.certificate.certificateNo}
                      <div style={{ fontSize: 12, color: '#6b7280' }}>
                        <ThaiDate value={c.certificate.issuedAt} />
                      </div>
                    </span>
                  </Space>
                ) : (
                  <Typography.Text type="secondary">-</Typography.Text>
                ),
            },
          ]}
        />
      )}
      <Modal
        open={!!override}
        title="ออกเกียรติบัตรให้ผู้ที่ไม่ผ่านเกณฑ์"
        okText="ยืนยันออกเกียรติบัตร"
        cancelText="ยกเลิก"
        onCancel={() => setOverride(null)}
        onOk={() => form.submit()}
        okButtonProps={{ loading: issue.isPending, danger: true }}
      >
        <Typography.Paragraph>ผู้ที่เลือกบางรายไม่ผ่านเกณฑ์ของแม่แบบนี้ หากยืนยันจะบันทึกเหตุผลไว้ใน Audit Log</Typography.Paragraph>
        <Form form={form} layout="vertical" onFinish={(v) => issue.mutate({ ids: override!, overrideReason: v.reason })}>
          <Form.Item name="reason" label="เหตุผล" rules={[{ required: true, min: 3, message: 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร' }]}>
            <Input.TextArea rows={2} maxLength={500} placeholder="เช่น ตอบแบบประเมินแบบกระดาษ" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
