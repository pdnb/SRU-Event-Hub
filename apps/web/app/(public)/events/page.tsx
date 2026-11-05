import { Suspense } from 'react';
import { EventBrowser } from '@/features/events/EventBrowser';

export const metadata = { title: 'กิจกรรมทั้งหมด' };

export default function EventsPage() {
  return (
    <div className="page-container" style={{ paddingTop: 24 }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>กิจกรรมทั้งหมด</h1>
      <p style={{ color: '#6b7280', marginTop: 0 }}>ค้นหาและกรองกิจกรรมตามประเภท หน่วยงาน วันที่ และค่าใช้จ่าย</p>
      <Suspense fallback={null}>
        <EventBrowser />
      </Suspense>
    </div>
  );
}
