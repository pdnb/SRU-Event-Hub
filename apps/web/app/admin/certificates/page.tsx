'use client';

import { PageHeader } from '@/components/PageHeader';
import { DeskEventPicker } from '@/features/checkin/DeskEventPicker';

export default function CertificateEventsPage() {
  return (
    <>
      <PageHeader title="เกียรติบัตร" description="ออกแบบแม่แบบ กำหนดเกณฑ์ ออกเกียรติบัตร และทะเบียนเกียรติบัตรของแต่ละกิจกรรม" breadcrumb={[{ title: 'เกียรติบัตร' }]} />
      <DeskEventPicker purpose="certificate" hrefFor={(id) => `/admin/certificates/${id}`} actionLabel="เกียรติบัตร" />
    </>
  );
}
