'use client';

import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrganizationDto } from '@sru/shared-types';
import { Alert, Button, Card, Form, Input, Modal, Select, Switch, Table, Tag } from 'antd';
import { useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/QueryState';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';

interface BankAccount {
  id: string;
  organizationId: string | null;
  organization: { id: string; nameTh: string } | null;
  bankName: string;
  branch: string | null;
  accountNo: string;
  accountName: string;
  promptPayId: string | null;
  isActive: boolean;
}
interface IncomeCode {
  id: string;
  code: string;
  nameTh: string;
  isActive: boolean;
}

function useCrud<T extends { id: string }>(key: string, url: string, label: string) {
  const qc = useQueryClient();
  const msg = useApiMessage();
  const list = useQuery({ queryKey: [key], queryFn: () => api.get<T[]>(url) });
  const save = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: object }) => (id ? api.patch(`${url}/${id}`, body) : api.post(url, body)),
    onSuccess: () => {
      msg.success(`บันทึก${label}แล้ว`);
      void qc.invalidateQueries({ queryKey: [key] });
      void qc.invalidateQueries({ queryKey: ['finance-options'] });
    },
    onError: msg.error,
  });
  return { list, save };
}

/** Receiving accounts and income codes (FIN-4, FIN-5). Issued payment orders keep their own snapshot. */
export default function FinanceSettingsPage() {
  const can = useCan();
  const banks = useCrud<BankAccount>('bank-accounts', '/finance/bank-accounts', 'บัญชีรับเงิน');
  const codes = useCrud<IncomeCode>('income-codes', '/finance/income-codes', 'รหัสรายได้');
  const orgs = useQuery({ queryKey: ['orgs-flat'], queryFn: () => api.get<OrganizationDto[]>('/organizations') });
  const [bankForm] = Form.useForm();
  const [codeForm] = Form.useForm();
  const [bankEdit, setBankEdit] = useState<BankAccount | 'new' | null>(null);
  const [codeEdit, setCodeEdit] = useState<IncomeCode | 'new' | null>(null);

  const openBank = (b: BankAccount | 'new') => {
    setBankEdit(b);
    bankForm.setFieldsValue(b === 'new' ? { isActive: true, organizationId: null } : { ...b, organizationId: b.organizationId ?? null });
  };
  const openCode = (c: IncomeCode | 'new') => {
    setCodeEdit(c);
    codeForm.setFieldsValue(c === 'new' ? { isActive: true } : c);
  };

  return (
    <>
      <PageHeader title="บัญชีรับเงินและรหัสรายได้" description="ข้อมูลที่ใช้พิมพ์บนใบแจ้งชำระและสร้างคิวอาร์พร้อมเพย์ — การแก้ไขไม่มีผลกับใบแจ้งชำระที่ออกไปแล้ว" breadcrumb={[{ title: 'การเงิน / กองคลัง' }, { title: 'บัญชีรับเงิน / รหัสรายได้' }]} />
      <Alert type="warning" showIcon style={{ marginBottom: 16 }} title="ข้อมูลเริ่มต้นเป็นข้อมูลตัวอย่าง" description="กรุณาแทนที่ด้วยบัญชีรับเงินและรหัสรายได้จริงที่ได้รับจากกองคลังก่อนเปิดใช้งาน (docs/OPEN_QUESTIONS.md FIN-4, FIN-5)" />
      <Card title="บัญชีรับเงิน" extra={can('bank_account:create') && <Button icon={<PlusOutlined />} onClick={() => openBank('new')}>เพิ่มบัญชี</Button>}>
        {banks.list.isError ? (
          <ErrorState error={banks.list.error} onRetry={() => banks.list.refetch()} />
        ) : (
          <Table<BankAccount>
            rowKey="id"
            loading={banks.list.isPending}
            dataSource={banks.list.data}
            pagination={false}
            scroll={{ x: 800 }}
            columns={[
              { title: 'ธนาคาร', render: (_, b) => `${b.bankName}${b.branch ? ` ${b.branch}` : ''}` },
              { title: 'เลขที่บัญชี', dataIndex: 'accountNo', width: 150 },
              { title: 'ชื่อบัญชี', dataIndex: 'accountName' },
              { title: 'พร้อมเพย์', dataIndex: 'promptPayId', width: 150, render: (v: string | null) => v ?? '-' },
              { title: 'หน่วยงาน', width: 140, render: (_, b) => b.organization?.nameTh ?? 'ส่วนกลาง' },
              { title: 'สถานะ', dataIndex: 'isActive', width: 100, render: (v: boolean) => (v ? <Tag color="green">ใช้งาน</Tag> : <Tag>ปิด</Tag>) },
              { title: '', width: 60, render: (_, b) => can('bank_account:update') && <Button type="text" aria-label="แก้ไข" icon={<EditOutlined />} onClick={() => openBank(b)} /> },
            ]}
          />
        )}
      </Card>

      <Card title="รหัสรายได้" style={{ marginTop: 16 }} extra={can('income_code:create') && <Button icon={<PlusOutlined />} onClick={() => openCode('new')}>เพิ่มรหัส</Button>}>
        {codes.list.isError ? (
          <ErrorState error={codes.list.error} onRetry={() => codes.list.refetch()} />
        ) : (
          <Table<IncomeCode>
            rowKey="id"
            loading={codes.list.isPending}
            dataSource={codes.list.data}
            pagination={false}
            columns={[
              { title: 'รหัส', dataIndex: 'code', width: 160 },
              { title: 'ชื่อ', dataIndex: 'nameTh' },
              { title: 'สถานะ', dataIndex: 'isActive', width: 100, render: (v: boolean) => (v ? <Tag color="green">ใช้งาน</Tag> : <Tag>ปิด</Tag>) },
              { title: '', width: 60, render: (_, c) => can('income_code:update') && <Button type="text" aria-label="แก้ไข" icon={<EditOutlined />} onClick={() => openCode(c)} /> },
            ]}
          />
        )}
      </Card>

      <Modal
        open={!!bankEdit}
        title={bankEdit === 'new' ? 'เพิ่มบัญชีรับเงิน' : 'แก้ไขบัญชีรับเงิน'}
        okText="บันทึก"
        cancelText="ยกเลิก"
        confirmLoading={banks.save.isPending}
        onCancel={() => setBankEdit(null)}
        onOk={() =>
          bankForm.validateFields().then((v) =>
            banks.save.mutate(
              { id: bankEdit === 'new' ? undefined : bankEdit?.id, body: { ...v, branch: v.branch || null, promptPayId: v.promptPayId || null } },
              { onSuccess: () => setBankEdit(null) },
            ),
          )
        }
        destroyOnHidden
      >
        <Form form={bankForm} layout="vertical" preserve={false}>
          <Form.Item name="bankName" label="ธนาคาร" rules={[{ required: true, min: 2 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="branch" label="สาขา">
            <Input />
          </Form.Item>
          <Form.Item name="accountNo" label="เลขที่บัญชี" rules={[{ required: true, pattern: /^[\d-]{6,20}$/, message: 'ตัวเลขและขีด 6–20 ตัว' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="accountName" label="ชื่อบัญชี" rules={[{ required: true, min: 2 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="promptPayId" label="รหัสพร้อมเพย์" help="เลขประจำตัวผู้เสียภาษี 13 หลัก / e-Wallet 15 หลัก / เบอร์โทร 10 หลัก — เว้นว่างหากไม่ใช้คิวอาร์" rules={[{ pattern: /^(\d{10}|\d{13}|\d{15})$/, message: 'รูปแบบไม่ถูกต้อง' }]}>
            <Input inputMode="numeric" />
          </Form.Item>
          <Form.Item name="organizationId" label="หน่วยงานเจ้าของบัญชี">
            <Select allowClear placeholder="ส่วนกลาง" options={orgs.data?.map((o) => ({ value: o.id, label: o.nameTh }))} />
          </Form.Item>
          <Form.Item name="isActive" label="ใช้งาน" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={!!codeEdit}
        title={codeEdit === 'new' ? 'เพิ่มรหัสรายได้' : 'แก้ไขรหัสรายได้'}
        okText="บันทึก"
        cancelText="ยกเลิก"
        confirmLoading={codes.save.isPending}
        onCancel={() => setCodeEdit(null)}
        onOk={() => codeForm.validateFields().then((v) => codes.save.mutate({ id: codeEdit === 'new' ? undefined : codeEdit?.id, body: v }, { onSuccess: () => setCodeEdit(null) }))}
        destroyOnHidden
      >
        <Form form={codeForm} layout="vertical" preserve={false}>
          <Form.Item name="code" label="รหัส" rules={[{ required: true, pattern: /^[\w.-]{1,30}$/, message: 'a-z, 0-9, . - _ ไม่เกิน 30 ตัว' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="nameTh" label="ชื่อ" rules={[{ required: true, min: 2 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="isActive" label="ใช้งาน" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
