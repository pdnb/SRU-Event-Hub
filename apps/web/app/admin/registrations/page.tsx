'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, Empty, Select } from 'antd';
import { useState } from 'react';
import type { EventSummaryDto } from '@sru/shared-types';
import { PageHeader } from '@/components/PageHeader';
import { RegistrationsTable } from '@/features/registration/RegistrationsTable';
import { api } from '@/services/api';

export default function RegistrationsPage() {
  const [eventId, setEventId] = useState<string>();
  const [search, setSearch] = useState('');
  const events = useQuery({
    queryKey: ['admin-events', 'picker', search],
    queryFn: () => api.getPage<EventSummaryDto>('/events', { perPage: 50, search: search || undefined }),
  });

  return (
    <>
      <PageHeader title="การลงทะเบียนรายบุคคล" description="เลือกกิจกรรมเพื่อดู ค้นหา ยกเลิก หรือส่งออกรายชื่อผู้ลงทะเบียน" breadcrumb={[{ title: 'การลงทะเบียน' }, { title: 'รายบุคคล' }]} />
      <Card>
        <Select
          showSearch={{ filterOption: false, onSearch: setSearch }}
          style={{ width: '100%', maxWidth: 640, marginBottom: 16 }}
          placeholder="ค้นหาและเลือกกิจกรรม"
          loading={events.isFetching}
          value={eventId}
          onChange={setEventId}
          options={events.data?.items.map((e) => ({ value: e.id, label: `${e.code} · ${e.titleTh}` }))}
        />
        {eventId ? <RegistrationsTable eventId={eventId} /> : <Empty description="กรุณาเลือกกิจกรรม" />}
      </Card>
    </>
  );
}
