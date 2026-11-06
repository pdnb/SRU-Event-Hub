'use client';

import { PageHeader } from '@/components/PageHeader';
import { DeskEventPicker } from '@/features/checkin/DeskEventPicker';

export default function CheckinEventsPage() {
  return (
    <>
      <PageHeader title="ตรวจสอบการเข้าร่วม (Check-in)" description="เลือกกิจกรรมเพื่อเปิดจุดเช็กอิน ดูภาพรวมแบบเรียลไทม์ และบันทึกการเข้าร่วม" breadcrumb={[{ title: 'ตรวจสอบการเข้าร่วม' }]} />
      <DeskEventPicker purpose="checkin" hrefFor={(id) => `/admin/checkin/${id}`} actionLabel="เปิดจุดเช็กอิน" />
    </>
  );
}
