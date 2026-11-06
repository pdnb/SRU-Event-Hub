'use client';

import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Col, Empty, Flex, Form, Input, Modal, Popconfirm, Radio, Row, Tag, Typography } from 'antd';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';
import { ROLE_LABEL, type CertTemplate } from './types';

type NewTemplate = { nameTh: string; audience: 'PARTICIPANT' | 'PERSONNEL'; orientation: 'landscape' | 'portrait' };

/** Rules of a template in one line, e.g. "เช็กอิน · ≥ 80% ของช่วง · ตอบแบบประเมิน". */
export function rulesText(t: CertTemplate) {
  if (t.audience === 'PERSONNEL') return t.personnelRoles.length ? t.personnelRoles.map((r) => ROLE_LABEL[r]).join(', ') : 'บุคลากรทุกบทบาท';
  const parts = [t.requireAttendance ? (t.countLate ? 'เช็กอิน (นับมาสาย)' : 'เช็กอินตรงเวลา') : 'ไม่ต้องเช็กอิน'];
  if (t.minSessionPercent) parts.push(`≥ ${t.minSessionPercent}% ของช่วงกิจกรรม`);
  if (t.requireEvaluation) parts.push('ตอบแบบประเมิน');
  return parts.join(' · ');
}

export function CertificateTemplates({ eventId, templates }: { eventId: string; templates: CertTemplate[] }) {
  const can = useCan();
  const router = useRouter();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<NewTemplate>();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['certificate-templates', eventId] });

  const create = useMutation({
    mutationFn: (v: NewTemplate) =>
      api.post<CertTemplate>(`/events/${eventId}/certificate-templates`, {
        nameTh: v.nameTh,
        audience: v.audience,
        widthMm: v.orientation === 'landscape' ? 297 : 210,
        heightMm: v.orientation === 'landscape' ? 210 : 297,
        ...(v.audience === 'PERSONNEL' ? { personnelRoles: ['SPEAKER'] } : {}),
      }),
    onSuccess: (t) => {
      refresh();
      router.push(`/admin/certificates/templates/${t.id}`);
    },
    onError: msg.error,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/certificate-templates/${id}`),
    onSuccess: () => {
      msg.success('ลบแม่แบบแล้ว');
      refresh();
    },
    onError: msg.error,
  });

  return (
    <>
      <Flex justify="space-between" align="center" style={{ marginBottom: 12 }} wrap gap={8}>
        <Typography.Text type="secondary">แต่ละแม่แบบกำหนดผู้มีสิทธิ์ได้รับของตนเอง — เช่น เกียรติบัตรผู้เข้าร่วม และเกียรติบัตรวิทยากร</Typography.Text>
        {can('certificate:create') && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              form.setFieldsValue({ nameTh: 'เกียรติบัตรผู้เข้าร่วมกิจกรรม', audience: 'PARTICIPANT', orientation: 'landscape' });
              setOpen(true);
            }}
          >
            สร้างแม่แบบ
          </Button>
        )}
      </Flex>
      {!templates.length ? (
        <Empty description="ยังไม่มีแม่แบบเกียรติบัตร" />
      ) : (
        <Row gutter={[16, 16]}>
          {templates.map((t) => (
            <Col key={t.id} xs={24} sm={12} lg={8}>
              <Card
                title={t.nameTh}
                actions={[
                  <Link key="e" href={`/admin/certificates/templates/${t.id}`}>
                    <EditOutlined /> {can('certificate:update') ? 'ออกแบบ' : 'ดู'}
                  </Link>,
                  ...(can('certificate:update')
                    ? [
                        <Popconfirm key="d" title="ลบแม่แบบนี้?" description="เกียรติบัตรที่ออกแล้วยังใช้ได้ตามเดิม" okText="ลบ" cancelText="ไม่" okButtonProps={{ danger: true }} onConfirm={() => remove.mutate(t.id)}>
                          <span>
                            <DeleteOutlined /> ลบ
                          </span>
                        </Popconfirm>,
                      ]
                    : []),
                ]}
              >
                <Flex vertical gap={6}>
                  <span>
                    <Tag color={t.audience === 'PARTICIPANT' ? 'blue' : 'purple'}>{t.audience === 'PARTICIPANT' ? 'ผู้เข้าร่วม' : 'บุคลากรของงาน'}</Tag>
                    <Tag>{t.widthMm >= t.heightMm ? 'A4 แนวนอน' : 'A4 แนวตั้ง'}</Tag>
                  </span>
                  <Typography.Text type="secondary">{rulesText(t)}</Typography.Text>
                  <Typography.Text>ออกแล้ว {t.issuedCount ?? 0} ฉบับ</Typography.Text>
                </Flex>
              </Card>
            </Col>
          ))}
        </Row>
      )}
      <Modal open={open} title="สร้างแม่แบบเกียรติบัตร" okText="สร้างและออกแบบ" cancelText="ยกเลิก" onCancel={() => setOpen(false)} onOk={() => form.submit()} okButtonProps={{ loading: create.isPending }} forceRender>
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
          <Form.Item name="nameTh" label="ชื่อแม่แบบ" rules={[{ required: true, message: 'กรุณาระบุชื่อ' }]}>
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="audience" label="มอบให้">
            <Radio.Group
              options={[
                { value: 'PARTICIPANT', label: 'ผู้ลงทะเบียนที่ผ่านเกณฑ์' },
                { value: 'PERSONNEL', label: 'บุคลากรของงาน (เช่น วิทยากร)' },
              ]}
            />
          </Form.Item>
          <Form.Item name="orientation" label="กระดาษ A4" extra="เริ่มจากรูปแบบมาตรฐาน แล้วปรับแต่ง ใส่ภาพพื้นหลัง และกำหนดเกณฑ์ในหน้าออกแบบ">
            <Radio.Group
              options={[
                { value: 'landscape', label: 'แนวนอน' },
                { value: 'portrait', label: 'แนวตั้ง' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
