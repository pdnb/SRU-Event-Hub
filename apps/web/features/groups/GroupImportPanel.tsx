'use client';

import { DownloadOutlined, InboxOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import type { GroupImportDto } from '@sru/shared-types';
import { Alert, Button, Flex, Space, Table, Tag, Typography, Upload } from 'antd';
import { useState } from 'react';
import { StatusTag } from '@/components/StatusTag';
import { useApiMessage } from '@/hooks/useApiMessage';
import { api } from '@/services/api';
import { downloadFile } from '@/services/download';

/** Excel import: download template → upload (every row checked) → preview → import valid rows. */
export function GroupImportPanel({ groupId, onImported }: { groupId: string; onImported: () => void }) {
  const msg = useApiMessage();
  const [preview, setPreview] = useState<GroupImportDto | null>(null);
  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post<GroupImportDto>(`/groups/${groupId}/imports`, fd);
    },
    onSuccess: setPreview,
    onError: msg.error,
  });
  const commit = useMutation({
    mutationFn: () => api.post(`/groups/${groupId}/imports/${preview!.id}/commit`),
    onSuccess: () => {
      msg.success(`นำเข้าสมาชิก ${preview!.validRows} คนแล้ว`);
      setPreview(null);
      onImported();
    },
    onError: msg.error,
  });
  const discard = useMutation({
    mutationFn: () => api.post(`/groups/${groupId}/imports/${preview!.id}/discard`),
    onSuccess: () => setPreview(null),
    onError: msg.error,
  });

  const columns = preview ? Object.keys(preview.rows[0]?.data ?? {}) : [];

  return (
    <>
      <Flex gap={12} wrap align="center" style={{ marginBottom: 16 }}>
        <Button icon={<DownloadOutlined />} onClick={() => downloadFile(`/groups/${groupId}/import-template`, 'group-members-template.xlsx').catch(msg.error)}>
          ดาวน์โหลดแม่แบบ Excel
        </Button>
        <Typography.Text type="secondary">แม่แบบมีคอลัมน์ตามคำถามของกิจกรรมนี้ และแผ่นงาน &quot;คำอธิบาย&quot; บอกค่าที่ใช้ได้</Typography.Text>
      </Flex>

      {!preview && (
        <Upload.Dragger
          accept=".xlsx"
          maxCount={1}
          showUploadList={false}
          disabled={upload.isPending}
          beforeUpload={(f) => {
            upload.mutate(f);
            return false;
          }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">{upload.isPending ? 'กำลังตรวจสอบไฟล์…' : 'คลิกหรือลากไฟล์ .xlsx มาวาง'}</p>
          <p className="ant-upload-hint">ระบบตรวจทุกแถวก่อน ยังไม่บันทึกจนกว่าจะกดยืนยันนำเข้า (ไม่เกิน 1,000 แถว)</p>
        </Upload.Dragger>
      )}

      {preview && (
        <>
          <Alert
            type={preview.invalidRows ? 'warning' : 'success'}
            showIcon
            style={{ marginBottom: 12 }}
            title={`${preview.fileName}: ถูกต้อง ${preview.validRows} แถว · มีปัญหา ${preview.invalidRows} แถว`}
            description={preview.invalidRows ? 'แถวที่มีปัญหาจะไม่ถูกนำเข้า — แก้ไขในไฟล์แล้วอัปโหลดใหม่ภายหลังได้' : undefined}
          />
          <Table
            size="small"
            rowKey="rowNo"
            dataSource={preview.rows}
            scroll={{ x: 'max-content' }}
            pagination={{ pageSize: 20, hideOnSinglePage: true }}
            columns={[
              { title: 'แถว', dataIndex: 'rowNo', width: 60, fixed: 'left' },
              {
                title: 'ผล',
                width: 110,
                render: (_, r) => (r.status === 'INVALID' ? <Tag color="red">มีปัญหา</Tag> : <Tag color="green">ถูกต้อง</Tag>),
              },
              {
                title: 'ปัญหา',
                width: 260,
                render: (_, r) =>
                  r.errors ? (
                    <Space direction="vertical" size={0}>
                      {Object.entries(r.errors).map(([k, v]) => (
                        <Typography.Text key={k} type="danger" style={{ fontSize: 13 }}>
                          {k}: {v}
                        </Typography.Text>
                      ))}
                    </Space>
                  ) : (
                    '-'
                  ),
              },
              ...columns.map((c) => ({ title: c, key: c, render: (_: unknown, r: GroupImportDto['rows'][number]) => r.data[c] || '' })),
            ]}
          />
          <Flex gap={8} justify="flex-end" style={{ marginTop: 12 }}>
            <Button onClick={() => discard.mutate()} loading={discard.isPending}>
              ยกเลิกไฟล์นี้
            </Button>
            <Button type="primary" disabled={!preview.validRows} loading={commit.isPending} onClick={() => commit.mutate()}>
              นำเข้า {preview.validRows} คน
            </Button>
          </Flex>
        </>
      )}
      {preview?.status && preview.status !== 'VALIDATED' && <StatusTag status={preview.status} />}
    </>
  );
}
