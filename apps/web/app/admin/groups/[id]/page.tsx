'use client';

import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { GroupWorkspace } from '@/features/groups/GroupWorkspace';

export default function AdminGroupPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <>
      <PageHeader title="กลุ่มลงทะเบียน" description="ข้อมูลกลุ่ม สมาชิก การชำระเงิน และประวัติการเปลี่ยนแปลง" breadcrumb={[{ title: 'จัดการกิจกรรม', href: '/admin/events' }, { title: 'กลุ่มลงทะเบียน' }]} />
      <GroupWorkspace groupId={id} mode="organizer" />
    </>
  );
}
