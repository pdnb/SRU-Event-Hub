'use client';

import { PlusOutlined } from '@ant-design/icons';
import { Button, Card, Space, Tabs } from 'antd';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { BookingDialog } from '@/features/venues/BookingDialog';
import { BookingList } from '@/features/venues/BookingList';
import { BuildingCatalog, ResourceCatalog, VenueCatalog } from '@/features/venues/VenueCatalog';
import { VenueSchedule } from '@/features/venues/VenueSchedule';
import { useCan } from '@/hooks/useMe';

export default function VenuesPage() {
  return (
    <Suspense>
      <Venues />
    </Suspense>
  );
}

function Venues() {
  const can = useCan();
  const router = useRouter();
  const tab = useSearchParams().get('tab') ?? 'schedule';
  const [dialog, setDialog] = useState<'venue' | 'resource' | null>(null);
  const items = [
    { key: 'schedule', label: 'ตารางว่าง', children: <VenueSchedule /> },
    ...(can('venue:approve') ? [{ key: 'approve', label: 'รอพิจารณา', children: <Card><BookingList view="approve" /></Card> }] : []),
    { key: 'mine', label: 'คำขอของฉัน', children: <Card><BookingList view="mine" /></Card> },
    { key: 'venues', label: 'สถานที่', children: <Card><VenueCatalog /></Card> },
    { key: 'resources', label: 'อุปกรณ์', children: <Card><ResourceCatalog /></Card> },
    { key: 'buildings', label: 'อาคาร', children: <Card><BuildingCatalog /></Card> },
  ];

  return (
    <>
      <PageHeader
        title="สถานที่และทรัพยากร"
        description="ตรวจสอบห้องว่าง ขอจองสถานที่/ยืมอุปกรณ์ และพิจารณาคำขอของหน่วยงาน"
        breadcrumb={[{ title: 'สถานที่และทรัพยากร' }]}
        actions={
          <Space wrap>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setDialog('venue')}>
              ขอจองสถานที่
            </Button>
            <Button icon={<PlusOutlined />} onClick={() => setDialog('resource')}>
              ขอยืมอุปกรณ์
            </Button>
          </Space>
        }
      />
      <Tabs activeKey={items.some((i) => i.key === tab) ? tab : 'schedule'} onChange={(k) => router.replace(`/admin/venues?tab=${k}`)} items={items} destroyOnHidden />
      <BookingDialog kind={dialog ?? 'venue'} open={!!dialog} onClose={() => setDialog(null)} />
    </>
  );
}
