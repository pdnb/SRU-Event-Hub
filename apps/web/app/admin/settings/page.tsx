'use client';

import { SaveOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, InputNumber, Space, Switch, Table, Typography } from 'antd';
import { useState } from 'react';
import { ThaiDate } from '@/components/Format';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/QueryState';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';

interface Setting {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: string;
}

/** Editor that keeps the value's JSON type (the API rejects type changes as well). */
function ValueEditor({ s, disabled }: { s: Setting; disabled: boolean }) {
  const qc = useQueryClient();
  const msg = useApiMessage();
  const isObject = typeof s.value === 'object' && s.value !== null;
  const [draft, setDraft] = useState<unknown>(isObject ? JSON.stringify(s.value, null, 2) : s.value);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (value: unknown) => api.patch(`/settings/${encodeURIComponent(s.key)}`, { value }),
    onSuccess: () => {
      msg.success(`บันทึก ${s.key} แล้ว`);
      void qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: msg.error,
  });
  const submit = () => {
    if (!isObject) return save.mutate(draft);
    try {
      save.mutate(JSON.parse(String(draft)));
    } catch {
      setJsonError('รูปแบบ JSON ไม่ถูกต้อง');
    }
  };
  const editor =
    typeof s.value === 'number' ? (
      <InputNumber value={draft as number} onChange={(v) => setDraft(v ?? 0)} disabled={disabled} />
    ) : typeof s.value === 'boolean' ? (
      <Switch checked={draft as boolean} onChange={setDraft} disabled={disabled} />
    ) : isObject ? (
      <Input.TextArea
        rows={3}
        value={String(draft)}
        onChange={(e) => { setDraft(e.target.value); setJsonError(null); }}
        status={jsonError ? 'error' : undefined}
        style={{ fontFamily: 'monospace', fontSize: 12, minWidth: 320 }}
        disabled={disabled}
      />
    ) : (
      <Input value={String(draft ?? '')} onChange={(e) => setDraft(e.target.value)} disabled={disabled} style={{ minWidth: 240 }} />
    );
  return (
    <Space align="start" wrap>
      {editor}
      {!disabled && <Button icon={<SaveOutlined />} loading={save.isPending} onClick={submit} aria-label={`บันทึก ${s.key}`}>บันทึก</Button>}
      {jsonError && <Typography.Text type="danger">{jsonError}</Typography.Text>}
    </Space>
  );
}

export default function SettingsPage() {
  const can = useCan();
  const list = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Setting[]>('/settings') });
  return (
    <>
      <PageHeader title="ตั้งค่าระบบ" description="ค่าที่ใช้ทั่วทั้งระบบ — แก้ไขได้เฉพาะค่าที่มีอยู่ และต้องคงชนิดข้อมูลเดิม ทุกการแก้ไขถูกบันทึกใน Audit log" breadcrumb={[{ title: 'ตั้งค่าระบบ' }]} />
      <Card>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : (
          <Table<Setting>
            rowKey="key"
            loading={list.isPending}
            dataSource={list.data}
            pagination={false}
            scroll={{ x: 800 }}
            columns={[
              { title: 'คีย์', dataIndex: 'key', width: 240, render: (v: string, s) => <><Typography.Text code>{v}</Typography.Text><div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{s.description}</Typography.Text></div></> },
              { title: 'ค่า', render: (_, s) => <ValueEditor key={`${s.key}-${s.updatedAt}`} s={s} disabled={!can('system_setting:update')} /> },
              { title: 'แก้ไขล่าสุด', dataIndex: 'updatedAt', width: 170, render: (v: string) => <ThaiDate value={v} time /> },
            ]}
          />
        )}
      </Card>
    </>
  );
}
