'use client';

import { PageHeader } from '@/components/PageHeader';
import { DeskEventPicker } from '@/features/checkin/DeskEventPicker';

export default function BadgeEventsPage() {
  return (
    <>
      <PageHeader title="ป้ายชื่อ" description="ออกแบบแม่แบบ พิมพ์ป้ายชื่อเป็นชุด และจัดการบุคลากรของงาน" breadcrumb={[{ title: 'ป้ายชื่อ' }]} />
      <DeskEventPicker purpose="badge" hrefFor={(id) => `/admin/badges/${id}`} actionLabel="ป้ายชื่อ" />
    </>
  );
}
