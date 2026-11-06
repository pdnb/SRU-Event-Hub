'use client';

import { PageHeader } from '@/components/PageHeader';
import { DeskEventPicker } from '@/features/checkin/DeskEventPicker';

export default function EvaluationEventsPage() {
  return (
    <>
      <PageHeader title="แบบประเมิน" description="สร้างแบบประเมินกิจกรรม เปิด/ปิดรับคำตอบ และดูผลการประเมิน" breadcrumb={[{ title: 'แบบประเมิน' }]} />
      <DeskEventPicker purpose="evaluation" hrefFor={(id) => `/admin/evaluations/${id}`} actionLabel="แบบประเมิน" />
    </>
  );
}
