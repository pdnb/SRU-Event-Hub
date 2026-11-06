'use client';

import { DownloadOutlined, FilePdfOutlined, SearchOutlined, StopOutlined } from '@ant-design/icons';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Flex, Form, Input, Modal, Segmented, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { ThaiDate } from '@/components/Format';
import { ErrorState } from '@/components/QueryState';
import { openPdf } from '@/features/badges/print';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';
import { downloadFile } from '@/services/download';
import type { CertificateRow } from './types';

/** The event's certificate register: every certificate issued, download, revoke, export. */
export function CertificateRegister({ eventId }: { eventId: string }) {
  const can = useCan();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const [q, setQ] = useState<{ page: number; perPage: number; search?: string; status?: 'ISSUED' | 'REVOKED' }>({ page: 1, perPage: 20 });
  const [search, setSearch] = useState('');
  const [revoking, setRevoking] = useState<CertificateRow | null>(null);
  const [form] = Form.useForm<{ reason: string }>();
  const list = useQuery({ queryKey: ['certificates', eventId, q], queryFn: () => api.getPage<CertificateRow>(`/events/${eventId}/certificates`, { ...q, order: 'asc' }), placeholderData: keepPreviousData });
  const revoke = useMutation({
    mutationFn: (reason: string) => api.post(`/certificates/${revoking!.id}/revoke`, { reason }),
    onSuccess: () => {
      msg.success('ยกเลิกเกียรติบัตรแล้ว');
      setRevoking(null);
      for (const k of ['certificates', 'certificate-candidates', 'certificate-templates']) void qc.invalidateQueries({ queryKey: [k, eventId] });
    },
    onError: msg.error,
  });
  const pdf = (id: string) => openPdf(api.http.get(`/certificates/${id}/pdf`, { responseType: 'blob' })).catch(msg.error);

  return (
    <>
      <Flex justify="space-between" gap={12} wrap style={{ marginBottom: 12 }}>
        <Space wrap>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="ชื่อ / เลขที่ / เลขอ้างอิง"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onPressEnter={() => setQ((x) => ({ ...x, page: 1, search: search.trim() || undefined }))}
            style={{ width: 260 }}
          />
          <Segmented
            value={q.status ?? 'all'}
            onChange={(v) => setQ((x) => ({ ...x, page: 1, status: v === 'all' ? undefined : (v as 'ISSUED' | 'REVOKED') }))}
            options={[
              { value: 'all', label: 'ทั้งหมด' },
              { value: 'ISSUED', label: 'ใช้ได้' },
              { value: 'REVOKED', label: 'ยกเลิกแล้ว' },
            ]}
          />
        </Space>
        {can('certificate:export') && (
          <Space wrap>
            <Button icon={<FilePdfOutlined />} onClick={() => void openPdf(api.http.post(`/events/${eventId}/certificates/pdf`, {}, { responseType: 'blob' })).catch(msg.error)}>
              PDF รวมทั้งหมด (สูงสุด 500)
            </Button>
            <Button icon={<DownloadOutlined />} onClick={() => void downloadFile(`/events/${eventId}/certificates/export`, 'certificates.xlsx').catch(msg.error)}>
              ทะเบียน Excel
            </Button>
          </Space>
        )}
      </Flex>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <Table<CertificateRow>
          rowKey="id"
          size="middle"
          loading={list.isFetching}
          dataSource={list.data?.items ?? []}
          scroll={{ x: 1000 }}
          pagination={{ current: q.page, pageSize: q.perPage, total: list.data?.meta.total ?? 0, showSizeChanger: true, onChange: (page, perPage) => setQ((x) => ({ ...x, page, perPage })) }}
          columns={[
            { title: 'เลขที่', dataIndex: 'certificateNo', width: 170 },
            {
              title: 'ผู้รับ',
              render: (_, c) => (
                <>
                  <div>{c.recipientName}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {c.template.nameTh}
                    {c.registration ? ` · ${c.registration.referenceNo}` : ''}
                  </Typography.Text>
                </>
              ),
            },
            {
              title: 'รหัสตรวจสอบ',
              width: 170,
              render: (_, c) => (
                <Typography.Link href={c.verifyUrl} target="_blank" copyable={{ text: c.verifyUrl }}>
                  {c.verifyCode}
                </Typography.Link>
              ),
            },
            {
              title: 'ออกเมื่อ',
              width: 170,
              render: (_, c) => (
                <>
                  <ThaiDate value={c.issuedAt} time />
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{c.issueMethod === 'SELF_CLAIM' ? 'ผู้เข้าร่วมรับเอง' : (c.issuedBy?.displayName ?? '')}</div>
                </>
              ),
            },
            {
              title: 'สถานะ',
              width: 150,
              render: (_, c) =>
                c.status === 'ISSUED' ? (
                  <Tag color="green">ใช้ได้</Tag>
                ) : (
                  <>
                    <Tag color="red">ยกเลิกแล้ว</Tag>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{c.revokeReason}</div>
                  </>
                ),
            },
            {
              title: '',
              width: 150,
              render: (_, c) => (
                <Space>
                  <Button size="small" icon={<FilePdfOutlined />} onClick={() => void pdf(c.id)} aria-label="เปิด PDF" />
                  {can('certificate:void') && c.status === 'ISSUED' && (
                    <Button
                      size="small"
                      danger
                      icon={<StopOutlined />}
                      onClick={() => {
                        form.resetFields();
                        setRevoking(c);
                      }}
                    >
                      ยกเลิก
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
      )}
      <Modal open={!!revoking} title={`ยกเลิกเกียรติบัตร ${revoking?.certificateNo ?? ''}`} okText="ยกเลิกเกียรติบัตร" cancelText="ปิด" okButtonProps={{ danger: true, loading: revoke.isPending }} onCancel={() => setRevoking(null)} onOk={() => form.submit()}>
        <Typography.Paragraph>
          หน้าตรวจสอบสาธารณะจะแสดงว่าเกียรติบัตรนี้ “ถูกยกเลิก” ทันที และยกเลิกย้อนกลับไม่ได้ — หากต้องการแก้ข้อมูล ให้ยกเลิกแล้วออกฉบับใหม่ (เลขที่ใหม่)
        </Typography.Paragraph>
        <Form form={form} layout="vertical" onFinish={(v) => revoke.mutate(v.reason)}>
          <Form.Item name="reason" label="เหตุผล" rules={[{ required: true, min: 3, message: 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร' }]}>
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
