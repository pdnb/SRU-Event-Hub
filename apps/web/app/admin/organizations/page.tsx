'use client';

import { PlusOutlined } from '@ant-design/icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Drawer, Flex, Form, Input, Popconfirm, Select, Switch, Table, Tag } from 'antd';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { OrganizationDto } from '@sru/shared-types';
import { RhfField } from '@/components/form/RhfField';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/QueryState';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';

const TYPES: Record<string, string> = {
  UNIVERSITY: 'มหาวิทยาลัย',
  FACULTY: 'คณะ',
  OFFICE: 'สำนัก',
  INSTITUTE: 'สถาบัน',
  DIVISION: 'กอง',
  CENTER: 'ศูนย์',
  OTHER: 'หน่วยงานอื่น',
};

const schema = z.object({
  code: z.string().regex(/^[A-Z0-9_-]{2,30}$/, 'ใช้ A-Z, 0-9, _ หรือ - (2–30 ตัว)'),
  nameTh: z.string().trim().min(2, 'กรุณาระบุชื่อหน่วยงาน').max(300),
  nameEn: z.string().max(300).optional(),
  type: z.enum(Object.keys(TYPES) as [string, ...string[]]),
  parentId: z.string().uuid().nullish(),
  isFinanceDivision: z.boolean(),
});
type Values = z.infer<typeof schema>;

type Row = OrganizationDto & { children?: Row[] };
const strip = (nodes: Row[]): Row[] => nodes.map((n) => ({ ...n, children: n.children?.length ? strip(n.children) : undefined }));
const flatten = (nodes: Row[], d = 0): { value: string; label: string }[] =>
  nodes.flatMap((n) => [{ value: n.id, label: `${'— '.repeat(d)}${n.nameTh}` }, ...flatten(n.children ?? [], d + 1)]);

export default function OrganizationsPage() {
  const can = useCan();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const tree = useQuery({ queryKey: ['orgs-admin-tree'], queryFn: () => api.get<Row[]>('/organizations/admin', { tree: true, includeInactive: true }) });

  const { control, handleSubmit, reset } = useForm<Values>({ resolver: zodResolver(schema) });
  const open = (row: Row | 'new') => {
    setEditing(row);
    reset(
      row === 'new'
        ? { code: '', nameTh: '', nameEn: '', type: 'FACULTY', parentId: null, isFinanceDivision: false }
        : { code: row.code, nameTh: row.nameTh, nameEn: row.nameEn ?? '', type: row.type, parentId: row.parentId, isFinanceDivision: row.isFinanceDivision },
    );
  };
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['orgs-admin-tree'] });
    void qc.invalidateQueries({ queryKey: ['orgs-tree'] });
    void qc.invalidateQueries({ queryKey: ['orgs-public'] });
  };
  const save = useMutation({
    mutationFn: (v: Values) =>
      editing === 'new'
        ? api.post('/organizations', { ...v, nameEn: v.nameEn || undefined, parentId: v.parentId ?? undefined })
        : api.patch(`/organizations/${(editing as Row).id}`, { nameTh: v.nameTh, nameEn: v.nameEn || null, type: v.type, parentId: v.parentId ?? null, isFinanceDivision: v.isFinanceDivision }),
    onSuccess: () => {
      msg.success('บันทึกแล้ว');
      setEditing(null);
      invalidate();
    },
    onError: msg.error,
  });
  const deactivate = useMutation({
    mutationFn: (id: string) => api.post(`/organizations/${id}/deactivate`),
    onSuccess: () => {
      msg.success('ยกเลิกหน่วยงานแล้ว');
      invalidate();
    },
    onError: msg.error,
  });

  return (
    <>
      <PageHeader
        title="จัดการหน่วยงาน"
        description="โครงสร้างหน่วยงานของมหาวิทยาลัย: คณะ สำนัก สถาบัน กอง ศูนย์"
        breadcrumb={[{ title: 'จัดการหน่วยงาน' }]}
        actions={can('organization:create') && <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>เพิ่มหน่วยงาน</Button>}
      />
      <Card>
        {tree.isError ? (
          <ErrorState error={tree.error} onRetry={() => tree.refetch()} />
        ) : (
          <Table<Row>
            rowKey="id"
            loading={tree.isPending}
            dataSource={strip(tree.data ?? [])}
            pagination={false}
            expandable={{ defaultExpandAllRows: true }}
            scroll={{ x: 700 }}
            columns={[
              { title: 'ชื่อหน่วยงาน', dataIndex: 'nameTh' },
              { title: 'รหัส', dataIndex: 'code', width: 120 },
              { title: 'ประเภท', dataIndex: 'type', width: 120, render: (t) => TYPES[t] ?? t },
              { title: 'สถานะ', dataIndex: 'isActive', width: 110, render: (a) => (a ? <Tag color="green">ใช้งาน</Tag> : <Tag>ยกเลิก</Tag>) },
              {
                title: '',
                width: 170,
                render: (_, r) => (
                  <Flex gap={4}>
                    {can('organization:update') && <Button size="small" type="link" onClick={() => open(r)}>แก้ไข</Button>}
                    {can('organization:delete') && r.isActive && r.type !== 'UNIVERSITY' && (
                      <Popconfirm title="ยกเลิกหน่วยงานนี้?" description="ต้องยกเลิกหน่วยงานย่อยก่อน" okText="ยืนยัน" cancelText="ไม่" onConfirm={() => deactivate.mutate(r.id)}>
                        <Button size="small" type="link" danger>
                          ยกเลิก
                        </Button>
                      </Popconfirm>
                    )}
                  </Flex>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'เพิ่มหน่วยงาน' : 'แก้ไขหน่วยงาน'}
        size={480}
        extra={<Button type="primary" loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v))}>บันทึก</Button>}
        destroyOnHidden
      >
        <Form layout="vertical">
          <RhfField control={control} name="code" label="รหัสหน่วยงาน" required>
            {(f) => <Input {...f} value={f.value as string} onChange={(e) => f.onChange(e.target.value.toUpperCase())} disabled={editing !== 'new'} />}
          </RhfField>
          <RhfField control={control} name="nameTh" label="ชื่อหน่วยงาน (ไทย)" required>
            {(f) => <Input {...f} value={f.value as string} />}
          </RhfField>
          <RhfField control={control} name="nameEn" label="ชื่อหน่วยงาน (อังกฤษ)">
            {(f) => <Input {...f} value={(f.value as string) ?? ''} />}
          </RhfField>
          <RhfField control={control} name="type" label="ประเภท" required>
            {(f) => <Select {...f} value={f.value} options={Object.entries(TYPES).map(([value, label]) => ({ value, label }))} />}
          </RhfField>
          <RhfField control={control} name="parentId" label="หน่วยงานแม่">
            {(f) => (
              <Select
                {...f}
                value={f.value || undefined}
                allowClear
                showSearch={{ optionFilterProp: 'label' }}
                options={flatten(tree.data ?? []).filter((o) => editing === 'new' || o.value !== (editing as Row | null)?.id)}
              />
            )}
          </RhfField>
          <RhfField control={control} name="isFinanceDivision" label="เป็นกองคลัง (เจ้าหน้าที่การเงินระดับมหาวิทยาลัย)" valuePropName="checked">
            {(f) => <Switch id={f.id} checked={f.value as boolean} onChange={f.onChange} />}
          </RhfField>
        </Form>
      </Drawer>
    </>
  );
}
