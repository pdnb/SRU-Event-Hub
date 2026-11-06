'use client';

import { Breadcrumb } from 'antd';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { GroupWorkspace } from '@/features/groups/GroupWorkspace';
import { useMe } from '@/hooks/useMe';

export default function MyGroupPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const router = useRouter();
  useEffect(() => {
    if (me.isError) router.replace(`/login?next=/my/groups/${id}`);
  }, [me.isError, router, id]);

  return (
    <div className="page-container" style={{ paddingTop: 20, maxWidth: 1200 }}>
      <Breadcrumb items={[{ title: <Link href="/">หน้าแรก</Link> }, { title: <Link href="/my/groups">การลงทะเบียนแบบกลุ่มของฉัน</Link> }, { title: 'กลุ่ม' }]} style={{ marginBottom: 16 }} />
      {me.data && <GroupWorkspace groupId={id} mode="coordinator" />}
    </div>
  );
}
