'use client';

import { EditOutlined } from '@ant-design/icons';
import type { BillingInfoDto } from '@sru/shared-types';
import { formatBranch, formatThaiTaxId, isValidThaiTaxId } from '@sru/shared-utils';
import { Button, Form, Input, Modal, Radio, Typography } from 'antd';
import { useState } from 'react';
import { useApiMessage } from '@/hooks/useApiMessage';

/** "บริษัท ก จำกัด (0-1055-36000-31-5 สำนักงานใหญ่)" or null for an individual receipt. */
export function billingLabel(b: BillingInfoDto | null | undefined): string | null {
  if (!b || b.type !== 'JURISTIC') return null;
  return `${b.name} (${formatThaiTaxId(b.taxId ?? '')} ${formatBranch(b.branch)})`;
}

type Values = { type: 'INDIVIDUAL' | 'JURISTIC'; name?: string; taxId?: string; branch?: string; address?: string };

/**
 * FIN-9: who the official receipt (issued by กองคลัง) is made out to. Shown with the payment
 * details; editable until กองคลัง records the receipt number.
 */
export function BillingEditor({ value, onSave, disabled }: { value: BillingInfoDto; onSave: (b: Values) => Promise<unknown>; disabled?: boolean }) {
  const msg = useApiMessage();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<Values>();
  const type = Form.useWatch('type', form);
  const label = billingLabel(value);

  const submit = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      await onSave(v.type === 'INDIVIDUAL' ? { type: 'INDIVIDUAL' } : { ...v, taxId: v.taxId?.replace(/[\s-]/g, ''), branch: v.branch || '00000' });
      msg.success('บันทึกข้อมูลการออกใบเสร็จแล้ว');
      setOpen(false);
    } catch (e) {
      msg.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Typography.Text>{label ?? 'ในนามผู้ชำระ (บุคคล)'}</Typography.Text>
      {!disabled && (
        <Button
          type="link"
          size="small"
          icon={<EditOutlined />}
          onClick={() => {
            form.setFieldsValue({ type: value.type, name: value.name ?? '', taxId: value.taxId ?? '', branch: value.branch ?? '00000', address: value.address ?? '' });
            setOpen(true);
          }}
        >
          {label ? 'แก้ไข' : 'ขอใบเสร็จในนามหน่วยงาน/นิติบุคคล'}
        </Button>
      )}
      <Modal open={open} title="ข้อมูลสำหรับออกใบเสร็จรับเงิน" okText="บันทึก" cancelText="ยกเลิก" onOk={submit} confirmLoading={saving} onCancel={() => setOpen(false)} destroyOnHidden>
        <Typography.Paragraph type="secondary">ใบเสร็จรับเงินออกโดยกองคลัง ตามข้อมูลนี้ (แก้ไขได้จนกว่ากองคลังจะออกใบเสร็จ)</Typography.Paragraph>
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="type" label="ออกใบเสร็จในนาม">
            <Radio.Group options={[{ value: 'INDIVIDUAL', label: 'บุคคล (ชื่อผู้ชำระ)' }, { value: 'JURISTIC', label: 'หน่วยงาน / นิติบุคคล' }]} />
          </Form.Item>
          {type === 'JURISTIC' && (
            <>
              <Form.Item name="name" label="ชื่อหน่วยงาน / นิติบุคคล" rules={[{ required: true, min: 2, message: 'กรุณาระบุชื่อ' }]}>
                <Input maxLength={300} />
              </Form.Item>
              <Form.Item
                name="taxId"
                label="เลขประจำตัวผู้เสียภาษี (13 หลัก)"
                rules={[{ required: true, message: 'กรุณาระบุเลขประจำตัวผู้เสียภาษี' }, { validator: (_, v: string) => (!v || isValidThaiTaxId(v) ? Promise.resolve() : Promise.reject(new Error('เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง'))) }]}
              >
                <Input inputMode="numeric" maxLength={17} />
              </Form.Item>
              <Form.Item name="branch" label="สาขา" help="00000 = สำนักงานใหญ่" rules={[{ pattern: /^\d{5}$/, message: 'ระบุเลขสาขา 5 หลัก' }]}>
                <Input inputMode="numeric" maxLength={5} style={{ maxWidth: 160 }} />
              </Form.Item>
              <Form.Item name="address" label="ที่อยู่" rules={[{ required: true, message: 'กรุณาระบุที่อยู่' }]}>
                <Input.TextArea rows={3} maxLength={1000} />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </>
  );
}
