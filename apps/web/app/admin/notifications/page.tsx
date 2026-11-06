'use client';

import { Tabs } from 'antd';
import { PageHeader } from '@/components/PageHeader';
import { NotificationLogs, NotificationTemplates } from '@/features/notifications/NotificationAdmin';

export default function NotificationAdminPage() {
  return (
    <>
      <PageHeader title="การแจ้งเตือน" description="ประวัติการส่งอีเมล/LINE และแม่แบบข้อความ" breadcrumb={[{ title: 'การแจ้งเตือน' }]} />
      <Tabs
        items={[
          { key: 'logs', label: 'ประวัติการส่ง', children: <NotificationLogs /> },
          { key: 'templates', label: 'แม่แบบข้อความ', children: <NotificationTemplates /> },
        ]}
      />
    </>
  );
}
