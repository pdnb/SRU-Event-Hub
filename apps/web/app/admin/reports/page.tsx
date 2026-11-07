'use client';

import { Tabs } from 'antd';
import { useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { EventReport, FinanceReportView, OverviewReport, ParticipantReportView, ReportFilterBar, currentFiscalYear } from '@/features/reports/ReportViews';
import type { ReportFilters } from '@/features/reports/types';
import { useCan } from '@/hooks/useMe';

export default function ReportsPage() {
  const can = useCan();
  const [filters, setFilters] = useState<ReportFilters>({ fiscalYear: currentFiscalYear() });
  const items = [
    { key: 'overview', label: 'ภาพรวม', children: <OverviewReport filters={filters} /> },
    { key: 'events', label: 'รายกิจกรรม', children: <EventReport filters={filters} /> },
    { key: 'participants', label: 'ผู้เข้าร่วม', children: <ParticipantReportView filters={filters} /> },
    ...(can('payment:view') ? [{ key: 'finance', label: 'การเงิน', children: <FinanceReportView filters={filters} /> }] : []),
  ];
  return (
    <>
      <PageHeader title="รายงาน" description="สรุปกิจกรรม ผู้เข้าร่วม การเงิน และความพึงพอใจ ในขอบเขตหน่วยงานที่ท่านรับผิดชอบ" breadcrumb={[{ title: 'รายงาน' }]} />
      <div style={{ marginBottom: 16 }}>
        <ReportFilterBar value={filters} onChange={setFilters} />
      </div>
      <Tabs items={items} destroyOnHidden />
    </>
  );
}
