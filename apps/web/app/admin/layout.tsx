import type { ReactNode } from 'react';
import { AdminShell } from '@/layouts/AdminShell';

export const metadata = { title: { default: 'ผู้ดูแลระบบ', template: '%s | SRU Event Hub' }, robots: { index: false } };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
