'use client';

import { DeleteOutlined, EditOutlined, PlusOutlined, StarFilled } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Col, Empty, Flex, Form, Input, Modal, Popconfirm, Row, Select, Tag, Typography } from 'antd';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';
import { SIZE_PRESETS, type BadgeTemplate, type TemplateSummary } from './types';

export function BadgeTemplates({ eventId, templates }: { eventId: string; templates: TemplateSummary[] }) {
  const can = useCan();
  const router = useRouter();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ nameTh: string; preset: string }>();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['badge-templates', eventId] });

  const create = useMutation({
    mutationFn: (v: { nameTh: string; preset: string }) => {
      const p = SIZE_PRESETS.find((s) => s.key === v.preset)!;
      return api.post<BadgeTemplate>(`/events/${eventId}/badge-templates`, { nameTh: v.nameTh, paper: p.paper, widthMm: p.widthMm, heightMm: p.heightMm });
    },
    onSuccess: (t) => {
      refresh();
      router.push(`/admin/badges/templates/${t.id}`);
    },
    onError: msg.error,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/badge-templates/${id}`),
    onSuccess: () => {
      msg.success('ลบแม่แบบแล้ว');
      refresh();
    },
    onError: msg.error,
  });

  return (
    <>
      <Flex justify="space-between" align="center" style={{ marginBottom: 12 }}>
        <Typography.Text type="secondary">แม่แบบที่มีดาวจะถูกใช้เมื่อพิมพ์ทันทีที่จุดเช็กอิน</Typography.Text>
        {can('badge:create') && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              form.setFieldsValue({ nameTh: 'ป้ายชื่อผู้เข้าร่วม', preset: 'hang' });
              setOpen(true);
            }}
          >
            สร้างแม่แบบ
          </Button>
        )}
      </Flex>
      {!templates.length ? (
        <Empty description="ยังไม่มีแม่แบบป้ายชื่อ" />
      ) : (
        <Row gutter={[16, 16]}>
          {templates.map((t) => (
            <Col key={t.id} xs={24} sm={12} lg={8}>
              <Card
                title={
                  <Flex gap={6} align="center">
                    {t.isDefault && <StarFilled style={{ color: '#c9a227' }} aria-label="ค่าเริ่มต้น" />}
                    {t.nameTh}
                  </Flex>
                }
                actions={[
                  <Link key="e" href={`/admin/badges/templates/${t.id}`}>
                    <EditOutlined /> {can('badge:update') ? 'ออกแบบ' : 'ดู'}
                  </Link>,
                  ...(can('badge:update')
                    ? [
                        <Popconfirm key="d" title="ลบแม่แบบนี้?" description="งานพิมพ์เดิมยังเปิดดูได้" okText="ลบ" cancelText="ไม่" okButtonProps={{ danger: true }} onConfirm={() => remove.mutate(t.id)}>
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
                    ขนาด {t.widthMm}×{t.heightMm} มม.
                  </span>
                  <span>
                    <Tag>{t.paper === 'LABEL' ? 'เครื่องพิมพ์บัตร/ฉลาก (1 ป้ายต่อหน้า)' : `กระดาษ A4 (${t.perSheet} ป้ายต่อแผ่น)`}</Tag>
                  </span>
                  <Typography.Text type="secondary">
                    {t.fieldCount} องค์ประกอบ · ใช้พิมพ์แล้ว {t.jobCount} งาน
                  </Typography.Text>
                </Flex>
              </Card>
            </Col>
          ))}
        </Row>
      )}
      <Modal open={open} title="สร้างแม่แบบป้ายชื่อ" okText="สร้างและออกแบบ" cancelText="ยกเลิก" onCancel={() => setOpen(false)} onOk={() => form.submit()} okButtonProps={{ loading: create.isPending }} forceRender>
        <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
          <Form.Item name="nameTh" label="ชื่อแม่แบบ" rules={[{ required: true, message: 'กรุณาระบุชื่อ' }]}>
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="preset" label="ขนาด" extra="เริ่มจากรูปแบบมาตรฐาน (ชื่องาน แถบสีตามประเภท ชื่อ หน่วยงาน QR) แล้วปรับแต่งต่อได้ — ขนาดอื่นแก้ได้ในหน้าออกแบบ">
            <Select options={SIZE_PRESETS.map((p) => ({ value: p.key, label: p.label }))} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
