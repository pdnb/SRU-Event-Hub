'use client';

import { Checkbox, Col, Form, Input, Row, Select, type FormInstance } from 'antd';
import type { GroupDetailDto, GroupMemberDto, RegistrationFieldDto } from '@sru/shared-types';
import { DynamicInput } from '@/features/registration/RegisterPanel';

export type MemberValues = {
  participantTypeCode: string;
  prefix?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  studentOrStaffCode?: string;
  affiliation?: string;
  program?: string;
  answers?: Record<string, unknown>;
  reason?: string;
  pdpaConsent?: boolean;
};

type Fields = GroupDetailDto['fields'];
type Types = GroupDetailDto['participantTypes'];

/** Form values from a stored member (answers array → object keyed by question). */
export function memberToValues(m: Pick<GroupMemberDto, 'participantTypeCode' | 'prefix' | 'firstName' | 'lastName' | 'email' | 'phone' | 'studentOrStaffCode' | 'affiliation' | 'program' | 'answers'>): MemberValues {
  return {
    participantTypeCode: m.participantTypeCode,
    prefix: m.prefix ?? undefined,
    firstName: m.firstName,
    lastName: m.lastName,
    email: m.email,
    phone: m.phone ?? undefined,
    studentOrStaffCode: m.studentOrStaffCode ?? undefined,
    affiliation: m.affiliation ?? undefined,
    program: m.program ?? undefined,
    answers: Object.fromEntries(m.answers.map((a) => [a.key, a.value])),
  };
}

/** Request body for the member endpoints (empty answers dropped, blanks → undefined). */
export function valuesToBody(v: MemberValues) {
  const blank = (s?: string) => (s?.trim() ? s.trim() : undefined);
  return {
    participantTypeCode: v.participantTypeCode,
    prefix: blank(v.prefix),
    firstName: v.firstName.trim(),
    lastName: v.lastName.trim(),
    email: v.email.trim(),
    phone: blank(v.phone),
    studentOrStaffCode: blank(v.studentOrStaffCode),
    affiliation: blank(v.affiliation),
    program: blank(v.program),
    answers: Object.entries(v.answers ?? {})
      .filter(([, val]) => val !== undefined && val !== null && val !== '' && !(Array.isArray(val) && !val.length))
      .map(([key, value]) => ({ key, value: Array.isArray(value) ? value.map(String) : String(value) })),
    ...(v.reason ? { reason: v.reason } : {}),
  };
}

/**
 * Member details. `strictRequired` = enforce the organizer's required questions now (invitation page);
 * the coordinator may leave them blank and complete them before submitting the group.
 */
export function MemberForm({
  form,
  fields,
  participantTypes,
  onFinish,
  strictRequired = false,
  askReason = false,
  lockType = false,
  askConsent = false,
  initialValues,
}: {
  form: FormInstance<MemberValues>;
  fields: Fields;
  participantTypes: Types;
  onFinish: (v: MemberValues) => void;
  strictRequired?: boolean;
  askReason?: boolean;
  lockType?: boolean;
  askConsent?: boolean;
  initialValues?: Partial<MemberValues>;
}) {
  return (
    <Form form={form} layout="vertical" onFinish={onFinish} initialValues={initialValues} requiredMark>
      <Form.Item name="participantTypeCode" label="ประเภทผู้เข้าร่วม" rules={[{ required: true, message: 'กรุณาเลือกประเภทผู้เข้าร่วม' }]} extra={lockType ? 'เปลี่ยนประเภทหลังส่งกลุ่มไม่ได้ (มีผลต่อค่าลงทะเบียน)' : undefined}>
        <Select disabled={lockType} placeholder="เลือกประเภท" options={participantTypes.map((t) => ({ value: t.code, label: t.nameTh }))} />
      </Form.Item>
      <Row gutter={8}>
        <Col xs={24} sm={6}>
          <Form.Item name="prefix" label="คำนำหน้า">
            <Input maxLength={50} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={9}>
          <Form.Item name="firstName" label="ชื่อ" rules={[{ required: true, whitespace: true, message: 'กรุณากรอกชื่อ' }]}>
            <Input maxLength={150} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={9}>
          <Form.Item name="lastName" label="นามสกุล" rules={[{ required: true, whitespace: true, message: 'กรุณากรอกนามสกุล' }]}>
            <Input maxLength={150} />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={8}>
        <Col xs={24} sm={14}>
          <Form.Item name="email" label="อีเมล" rules={[{ required: true, type: 'email', message: 'กรุณากรอกอีเมลที่ถูกต้อง' }]}>
            <Input type="email" maxLength={254} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={10}>
          <Form.Item name="phone" label="เบอร์โทรศัพท์" rules={[{ pattern: /^0\d{8,9}$/, message: 'เบอร์โทรศัพท์ไม่ถูกต้อง' }]}>
            <Input inputMode="tel" maxLength={10} />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={8}>
        <Col xs={24} sm={8}>
          <Form.Item name="studentOrStaffCode" label="รหัสนักเรียน/นักศึกษา/บุคลากร">
            <Input maxLength={30} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={8}>
          <Form.Item name="affiliation" label="หน่วยงาน/สังกัด">
            <Input maxLength={300} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={8}>
          <Form.Item name="program" label="หลักสูตร/สาขา/ชั้นเรียน">
            <Input maxLength={300} />
          </Form.Item>
        </Col>
      </Row>
      {fields.map((f) => (
        <Form.Item
          key={f.key}
          name={['answers', f.key]}
          label={f.labelTh}
          required={f.isRequired}
          rules={strictRequired && f.isRequired ? [{ required: true, message: `กรุณากรอก ${f.labelTh}` }] : []}
          extra={!strictRequired && f.isRequired ? 'จำเป็นก่อนส่งกลุ่ม (เว้นไว้ให้สมาชิกกรอกเองผ่านลิงก์เชิญได้)' : undefined}
        >
          <DynamicInput field={{ ...f, fieldType: f.fieldType as RegistrationFieldDto['fieldType'] }} />
        </Form.Item>
      ))}
      {askReason && (
        <Form.Item name="reason" label="เหตุผลการแก้ไข / เปลี่ยนตัว" rules={[{ required: true, min: 3, message: 'กรุณาระบุเหตุผล' }]}>
          <Input.TextArea rows={2} maxLength={1000} showCount />
        </Form.Item>
      )}
      {askConsent && (
        <Form.Item name="pdpaConsent" valuePropName="checked" rules={[{ validator: (_, v) => (v ? Promise.resolve() : Promise.reject(new Error('กรุณายอมรับนโยบายคุ้มครองข้อมูลส่วนบุคคล'))) }]}>
          <Checkbox>ข้าพเจ้ายินยอมให้มหาวิทยาลัยเก็บรวบรวมและใช้ข้อมูลส่วนบุคคลข้างต้นเพื่อการจัดกิจกรรมนี้ ตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562</Checkbox>
        </Form.Item>
      )}
    </Form>
  );
}
