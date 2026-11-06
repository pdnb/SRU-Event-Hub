'use client';

import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Col, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Switch, Table, Typography } from 'antd';
import { useState } from 'react';
import { ThaiDate, ThaiDateRange } from '@/components/Format';
import { useApiMessage } from '@/hooks/useApiMessage';
import { useCan } from '@/hooks/useMe';
import { api } from '@/services/api';
import dayjs, { DATETIME_FMT } from '@/services/dayjs';
import type { CheckinSettings, Location, Schedule } from './types';

/** Check-in window, check-in points (multi-desk) and sessions. */
export function CheckinSettingsPanel({ eventId, settings }: { eventId: string; settings: CheckinSettings }) {
  const can = useCan();
  const qc = useQueryClient();
  const msg = useApiMessage();
  const [loc, setLoc] = useState<Partial<Location> | null>(null);
  const [sched, setSched] = useState<Partial<Schedule> | null>(null);
  const [locForm] = Form.useForm();
  const [schedForm] = Form.useForm();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['checkin-settings', eventId] });
  const editable = can('checkin:update');

  const saveWindow = useMutation({
    mutationFn: (v: { opensBeforeMinutes: number; lateAfterMinutes: number | null }) => api.put(`/events/${eventId}/checkin/settings`, v),
    onSuccess: () => {
      msg.success('บันทึกช่วงเวลาเช็กอินแล้ว');
      refresh();
    },
    onError: msg.error,
  });
  const saveLoc = useMutation({
    mutationFn: (v: { nameTh: string; scheduleId?: string | null; isActive?: boolean }) =>
      loc?.id ? api.patch(`/checkin/locations/${loc.id}`, { ...v, scheduleId: v.scheduleId ?? null }) : api.post(`/events/${eventId}/checkin/locations`, { nameTh: v.nameTh, scheduleId: v.scheduleId ?? undefined }),
    onSuccess: () => {
      msg.success('บันทึกจุดเช็กอินแล้ว');
      setLoc(null);
      refresh();
    },
    onError: msg.error,
  });
  const toggleLoc = useMutation({
    mutationFn: (l: Location) => api.patch(`/checkin/locations/${l.id}`, { isActive: !l.isActive }),
    onSuccess: refresh,
    onError: msg.error,
  });
  const saveSched = useMutation({
    mutationFn: (v: { title: string; range: [dayjs.Dayjs, dayjs.Dayjs]; venueText?: string }) => {
      const body = { title: v.title, startAt: v.range[0].toISOString(), endAt: v.range[1].toISOString(), venueText: v.venueText || undefined };
      return sched?.id ? api.put(`/event-schedules/${sched.id}`, body) : api.post(`/events/${eventId}/schedules`, body);
    },
    onSuccess: () => {
      msg.success('บันทึกช่วงกิจกรรมแล้ว');
      setSched(null);
      refresh();
    },
    onError: msg.error,
  });
  const delSched = useMutation({
    mutationFn: (id: string) => api.del(`/event-schedules/${id}`),
    onSuccess: refresh,
    onError: msg.error,
  });

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={10}>
        <Card title="ช่วงเวลาเช็กอิน">
          <Typography.Paragraph type="secondary">
            เปิดเช็กอิน <ThaiDate value={settings.opensAt} time /> ถึง <ThaiDate value={settings.closesAt} time />
          </Typography.Paragraph>
          <Form
            layout="vertical"
            disabled={!editable}
            initialValues={{ opensBeforeMinutes: settings.opensBeforeMinutes, lateEnabled: settings.lateAfterMinutes !== null, lateAfterMinutes: settings.lateAfterMinutes ?? 15 }}
            onFinish={(v: { opensBeforeMinutes: number; lateEnabled: boolean; lateAfterMinutes: number }) => saveWindow.mutate({ opensBeforeMinutes: v.opensBeforeMinutes, lateAfterMinutes: v.lateEnabled ? v.lateAfterMinutes : null })}
          >
            <Form.Item name="opensBeforeMinutes" label="เปิดเช็กอินก่อนเวลาเริ่ม (นาที)" rules={[{ required: true }]}>
              <InputNumber min={0} max={10080} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="lateEnabled" label="นับ “มาสาย”" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(a, b) => a.lateEnabled !== b.lateEnabled}>
              {({ getFieldValue }) =>
                getFieldValue('lateEnabled') && (
                  <Form.Item name="lateAfterMinutes" label="มาสายเมื่อเช็กอินหลังเวลาเริ่ม (นาที)" extra="ใช้เวลาเริ่มของช่วงกิจกรรม หากเช็กอินเข้าช่วงนั้น" rules={[{ required: true }]}>
                    <InputNumber min={0} max={1440} style={{ width: '100%' }} />
                  </Form.Item>
                )
              }
            </Form.Item>
            {editable && (
              <Button type="primary" htmlType="submit" loading={saveWindow.isPending}>
                บันทึก
              </Button>
            )}
          </Form>
        </Card>
      </Col>
      <Col xs={24} lg={14}>
        <Card
          title="จุดเช็กอิน"
          extra={
            editable && (
              <Button
                icon={<PlusOutlined />}
                onClick={() => {
                  setLoc({});
                  locForm.resetFields();
                }}
              >
                เพิ่มจุด
              </Button>
            )
          }
        >
          <Typography.Paragraph type="secondary">เปิดหลายจุดพร้อมกันได้ — ระบบกันการเช็กอินซ้ำข้ามจุดอัตโนมัติ จุดที่ผูกกับช่วงกิจกรรมจะบันทึกการเข้าร่วมของช่วงนั้นด้วย</Typography.Paragraph>
          <Table<Location>
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={settings.locations}
            locale={{ emptyText: 'ยังไม่มีจุดเช็กอิน (เช็กอินได้โดยไม่ระบุจุด)' }}
            columns={[
              { title: 'ชื่อจุด', dataIndex: 'nameTh' },
              { title: 'ช่วงกิจกรรม', dataIndex: 'scheduleId', render: (id) => settings.schedules.find((s) => s.id === id)?.title ?? 'ทั้งกิจกรรม' },
              { title: 'ใช้งาน', dataIndex: 'isActive', width: 90, render: (_, l) => <Switch size="small" checked={l.isActive} disabled={!editable} onChange={() => toggleLoc.mutate(l)} /> },
              {
                title: '',
                width: 50,
                render: (_, l) =>
                  editable && (
                    <Button
                      size="small"
                      type="text"
                      icon={<EditOutlined />}
                      aria-label="แก้ไขจุดเช็กอิน"
                      onClick={() => {
                        setLoc(l);
                        locForm.setFieldsValue({ nameTh: l.nameTh, scheduleId: l.scheduleId ?? undefined });
                      }}
                    />
                  ),
              },
            ]}
          />
        </Card>
        <Card
          style={{ marginTop: 16 }}
          title="ช่วงกิจกรรม (Session)"
          extra={
            can('event:update') && (
              <Button
                icon={<PlusOutlined />}
                onClick={() => {
                  setSched({});
                  schedForm.resetFields();
                }}
              >
                เพิ่มช่วง
              </Button>
            )
          }
        >
          {!settings.schedules.length && <Alert type="info" showIcon title="กิจกรรมหลายช่วง (เช่น หลายวัน / หลายห้อง) เพิ่มช่วงเพื่อเก็บการเข้าร่วมแยกแต่ละช่วงได้" />}
          {settings.schedules.length > 0 && (
            <Table<Schedule>
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={settings.schedules}
              columns={[
                { title: 'ช่วง', dataIndex: 'title' },
                { title: 'เวลา', render: (_, s) => <ThaiDateRange start={s.startAt} end={s.endAt} /> },
                {
                  title: '',
                  width: 90,
                  render: (_, s) =>
                    can('event:update') && (
                      <>
                        <Button
                          size="small"
                          type="text"
                          icon={<EditOutlined />}
                          aria-label="แก้ไขช่วงกิจกรรม"
                          onClick={() => {
                            setSched(s);
                            schedForm.setFieldsValue({ title: s.title, range: [dayjs(s.startAt), dayjs(s.endAt)], venueText: s.venueText ?? undefined });
                          }}
                        />
                        <Popconfirm title="ลบช่วงกิจกรรมนี้?" okText="ลบ" cancelText="ไม่" okButtonProps={{ danger: true }} onConfirm={() => delSched.mutate(s.id)}>
                          <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label="ลบช่วงกิจกรรม" />
                        </Popconfirm>
                      </>
                    ),
                },
              ]}
            />
          )}
        </Card>
      </Col>

      <Modal open={!!loc} title={loc?.id ? 'แก้ไขจุดเช็กอิน' : 'เพิ่มจุดเช็กอิน'} okText="บันทึก" cancelText="ยกเลิก" onCancel={() => setLoc(null)} onOk={() => locForm.submit()} okButtonProps={{ loading: saveLoc.isPending }} forceRender>
        <Form form={locForm} layout="vertical" onFinish={(v) => saveLoc.mutate(v)}>
          <Form.Item name="nameTh" label="ชื่อจุด" rules={[{ required: true, message: 'กรุณาระบุชื่อจุด' }]}>
            <Input maxLength={200} placeholder="เช่น โต๊ะลงทะเบียน 1 / ประตูทิศเหนือ" />
          </Form.Item>
          <Form.Item name="scheduleId" label="ช่วงกิจกรรม">
            <Select allowClear placeholder="ทั้งกิจกรรม" options={settings.schedules.map((s) => ({ value: s.id, label: s.title }))} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal open={!!sched} title={sched?.id ? 'แก้ไขช่วงกิจกรรม' : 'เพิ่มช่วงกิจกรรม'} okText="บันทึก" cancelText="ยกเลิก" onCancel={() => setSched(null)} onOk={() => schedForm.submit()} okButtonProps={{ loading: saveSched.isPending }} forceRender>
        <Form form={schedForm} layout="vertical" onFinish={(v) => saveSched.mutate(v)}>
          <Form.Item name="title" label="ชื่อช่วง" rules={[{ required: true, message: 'กรุณาระบุชื่อช่วง' }]}>
            <Input maxLength={300} placeholder="เช่น วันที่ 1 ภาคเช้า / Workshop ห้อง 2" />
          </Form.Item>
          <Form.Item name="range" label="เวลา" rules={[{ required: true, message: 'กรุณาระบุเวลา' }]}>
            <DatePicker.RangePicker showTime={{ format: 'HH:mm' }} format={DATETIME_FMT} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="venueText" label="สถานที่">
            <Input maxLength={300} />
          </Form.Item>
        </Form>
      </Modal>
    </Row>
  );
}
