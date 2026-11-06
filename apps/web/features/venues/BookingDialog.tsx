'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, DatePicker, Form, Input, InputNumber, Modal, Select, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { useEffect } from 'react';
import { useApiMessage } from '@/hooks/useApiMessage';
import { api } from '@/services/api';
import dayjs, { DATETIME_FMT } from '@/services/dayjs';
import type { Resource, Venue } from './types';

interface Values {
  targetId: string;
  range: [Dayjs, Dayjs];
  quantity?: number;
  purpose?: string;
}

/**
 * Request a venue or an equipment item. With `eventId` the booking belongs to that event (needs
 * event:update on it); the time defaults to the event's. Equipment shows live availability.
 */
export function BookingDialog({
  kind,
  open,
  onClose,
  eventId,
  defaultRange,
  defaultTargetId,
}: {
  kind: 'venue' | 'resource';
  open: boolean;
  onClose: () => void;
  eventId?: string;
  defaultRange?: [string, string];
  defaultTargetId?: string;
}) {
  const qc = useQueryClient();
  const msg = useApiMessage();
  const [form] = Form.useForm<Values>();
  const targets = useQuery({
    queryKey: [kind === 'venue' ? 'venues' : 'resources', 'all-active'],
    queryFn: () => api.getPage<Venue | Resource>(kind === 'venue' ? '/venues' : '/resources', { perPage: 100 }),
    enabled: open,
    staleTime: 60_000,
  });
  const targetId = Form.useWatch('targetId', form);
  const range = Form.useWatch('range', form);
  const avail = useQuery({
    queryKey: ['resource-availability', targetId, range?.[0]?.toISOString(), range?.[1]?.toISOString()],
    queryFn: () => api.get<{ quantity: number; used: number; available: number }>(`/resources/${targetId}/availability`, { from: range![0].toISOString(), to: range![1].toISOString() }),
    enabled: open && kind === 'resource' && !!targetId && !!range?.[0] && !!range?.[1] && range[1].isAfter(range[0]),
  });

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({
      targetId: defaultTargetId,
      range: defaultRange ? [dayjs(defaultRange[0]), dayjs(defaultRange[1])] : undefined,
      quantity: 1,
    });
  }, [open, defaultRange, defaultTargetId, form]);

  const save = useMutation({
    mutationFn: (v: Values) =>
      api.post<{ status: string }>(kind === 'venue' ? '/venue-bookings' : '/resource-bookings', {
        ...(kind === 'venue' ? { venueId: v.targetId } : { resourceId: v.targetId, quantity: v.quantity }),
        startAt: v.range[0].toISOString(),
        endAt: v.range[1].toISOString(),
        eventId,
        purpose: v.purpose?.trim() || undefined,
      }),
    onSuccess: (b) => {
      msg.success(b.status === 'APPROVED' ? 'จองสำเร็จ (อนุมัติอัตโนมัติ)' : 'ส่งคำขอจองแล้ว รอการพิจารณา');
      for (const k of ['venue-bookings', 'resource-bookings', 'venue-availability']) void qc.invalidateQueries({ queryKey: [k] });
      onClose();
    },
    onError: msg.error,
  });

  return (
    <Modal open={open} title={kind === 'venue' ? 'ขอจองสถานที่' : 'ขอยืมอุปกรณ์'} okText="ส่งคำขอ" cancelText="ยกเลิก" onCancel={onClose} onOk={() => form.submit()} okButtonProps={{ loading: save.isPending }} forceRender destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
        <Form.Item name="targetId" label={kind === 'venue' ? 'สถานที่' : 'อุปกรณ์'} rules={[{ required: true, message: 'กรุณาเลือก' }]}>
          <Select
            showSearch
            loading={targets.isPending}
            optionFilterProp="label"
            options={(targets.data?.items ?? []).map((t) => ({
              value: t.id,
              label: 'capacity' in t ? `${t.nameTh} (${t.code}${t.capacity ? ` · ${t.capacity} ที่นั่ง` : ''})` : `${t.nameTh} (${(t as Resource).resourceType} · มี ${(t as Resource).quantity})`,
            }))}
          />
        </Form.Item>
        <Form.Item name="range" label="ช่วงเวลา" rules={[{ required: true, message: 'กรุณาระบุช่วงเวลา' }]}>
          <DatePicker.RangePicker showTime={{ format: 'HH:mm', minuteStep: 15 }} format={DATETIME_FMT} style={{ width: '100%' }} />
        </Form.Item>
        {kind === 'resource' && (
          <>
            <Form.Item name="quantity" label="จำนวน" rules={[{ required: true }]}>
              <InputNumber min={1} max={avail.data?.quantity ?? 100000} style={{ width: 160 }} />
            </Form.Item>
            {avail.data && <Alert type={avail.data.available ? 'info' : 'warning'} showIcon style={{ marginBottom: 16 }} title={`ว่าง ${avail.data.available} จาก ${avail.data.quantity} ในช่วงเวลานี้`} />}
          </>
        )}
        <Form.Item name="purpose" label="วัตถุประสงค์" rules={eventId ? [] : [{ required: true, message: 'กรุณาระบุวัตถุประสงค์' }]}>
          <Input.TextArea rows={2} maxLength={1000} placeholder={eventId ? 'ไม่บังคับ — ใช้ชื่อกิจกรรม' : 'เช่น ประชุมคณะกรรมการ'} />
        </Form.Item>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          คำขอจะถูกส่งให้หน่วยงานที่ดูแล{kind === 'venue' ? 'สถานที่' : 'อุปกรณ์'}พิจารณา — ห้องที่ตั้งค่าอนุมัติอัตโนมัติจะได้รับการยืนยันทันทีถ้าว่าง
        </Typography.Text>
      </Form>
    </Modal>
  );
}
