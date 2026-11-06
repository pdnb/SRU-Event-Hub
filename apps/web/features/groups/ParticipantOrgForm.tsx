'use client';

import { useMutation } from '@tanstack/react-query';
import { Col, Form, Input, Modal, Row, Select } from 'antd';
import type { ParticipantOrganizationDto } from '@sru/shared-types';
import { useApiMessage } from '@/hooks/useApiMessage';
import { api } from '@/services/api';

export const ORG_TYPES = [
  { value: 'SCHOOL', label: 'โรงเรียน' },
  { value: 'UNIVERSITY', label: 'สถาบันอุดมศึกษา' },
  { value: 'GOVERNMENT', label: 'หน่วยงานราชการ / รัฐวิสาหกิจ' },
  { value: 'LOCAL_GOVERNMENT', label: 'องค์กรปกครองส่วนท้องถิ่น' },
  { value: 'PRIVATE', label: 'บริษัท / เอกชน' },
  { value: 'COMMUNITY', label: 'ชุมชน / มูลนิธิ / สมาคม' },
  { value: 'OTHER', label: 'อื่น ๆ' },
];
export const orgTypeLabel = (v: string) => ORG_TYPES.find((t) => t.value === v)?.label ?? v;

type Values = { nameTh: string; orgType: string; taxId?: string; branch?: string; address?: string; province?: string; phone?: string; email?: string; position?: string };

/** Create / edit an organization that sends participants. The creator becomes its coordinator. */
export function ParticipantOrgForm({
  open,
  org,
  onClose,
  onSaved,
}: {
  open: boolean;
  org?: ParticipantOrganizationDto | null;
  onClose: () => void;
  onSaved: (o: ParticipantOrganizationDto) => void;
}) {
  const [form] = Form.useForm<Values>();
  const msg = useApiMessage();
  const save = useMutation({
    mutationFn: (v: Values) => {
      const body = Object.fromEntries(Object.entries(v).map(([k, val]) => [k, typeof val === 'string' ? val.trim() || undefined : val]));
      return org ? api.put<ParticipantOrganizationDto>(`/participant-orgs/${org.id}`, body) : api.post<ParticipantOrganizationDto>('/participant-orgs', body);
    },
    onSuccess: (o) => {
      msg.success(org ? 'บันทึกข้อมูลองค์กรแล้ว' : 'สร้างองค์กรแล้ว');
      onSaved(o);
    },
    onError: msg.error,
  });

  return (
    <Modal
      open={open}
      title={org ? 'แก้ไขข้อมูลองค์กร' : 'เพิ่มองค์กรผู้ส่งเข้าร่วม'}
      okText="บันทึก"
      cancelText="ยกเลิก"
      onOk={() => form.submit()}
      onCancel={onClose}
      confirmLoading={save.isPending}
      destroyOnHidden
      width={640}
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={org ? { ...org, taxId: org.taxId ?? undefined, branch: org.branch ?? undefined } : { orgType: 'SCHOOL' }}
        onFinish={(v) => save.mutate(v)}
      >
        <Form.Item name="nameTh" label="ชื่อองค์กร / สถานศึกษา" rules={[{ required: true, min: 2, message: 'กรุณากรอกชื่อองค์กร' }]}>
          <Input maxLength={300} />
        </Form.Item>
        <Row gutter={8}>
          <Col xs={24} sm={12}>
            <Form.Item name="orgType" label="ประเภท" rules={[{ required: true }]}>
              <Select options={ORG_TYPES} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="province" label="จังหวัด">
              <Input maxLength={100} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={8}>
          <Col xs={24} sm={12}>
            <Form.Item name="phone" label="โทรศัพท์" rules={[{ pattern: /^0\d{8,9}$/, message: 'เบอร์โทรศัพท์ไม่ถูกต้อง' }]}>
              <Input inputMode="tel" maxLength={10} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="email" label="อีเมลองค์กร" rules={[{ type: 'email', message: 'อีเมลไม่ถูกต้อง' }]}>
              <Input maxLength={254} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="address" label="ที่อยู่ (ใช้ออกใบเสร็จในนามองค์กร)">
          <Input.TextArea rows={2} maxLength={1000} />
        </Form.Item>
        <Row gutter={8}>
          <Col xs={24} sm={14}>
            <Form.Item name="taxId" label="เลขประจำตัวผู้เสียภาษี (13 หลัก)" extra="ถ้ากรอกพร้อมที่อยู่ ใบแจ้งชำระของกลุ่มจะออกใบเสร็จในนามองค์กรโดยอัตโนมัติ">
              <Input inputMode="numeric" maxLength={17} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={10}>
            <Form.Item name="branch" label="สาขา (00000 = สำนักงานใหญ่)" rules={[{ pattern: /^\d{5}$/, message: 'เลข 5 หลัก' }]}>
              <Input inputMode="numeric" maxLength={5} placeholder="00000" />
            </Form.Item>
          </Col>
        </Row>
        {!org && (
          <Form.Item name="position" label="ตำแหน่งของท่านในองค์กร">
            <Input maxLength={200} placeholder="เช่น ครูผู้ประสานงาน" />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
