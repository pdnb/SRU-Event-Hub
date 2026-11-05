import type { ReactNode } from 'react';
import { PublicHeader } from '@/layouts/PublicHeader';
import { brand } from '@/styles/theme';

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <PublicHeader />
      <main style={{ flex: 1 }}>{children}</main>
      <footer style={{ background: brand.sidebar, color: '#cbd5e1', padding: '32px 0', marginTop: 48 }}>
        <div className="page-container">
          <strong style={{ color: '#fff' }}>มหาวิทยาลัยราชภัฏสุราษฎร์ธานี</strong>
          <div style={{ fontSize: 14, marginTop: 4 }}>272 หมู่ 9 ตำบลขุนทะเล อำเภอเมือง จังหวัดสุราษฎร์ธานี 84100</div>
          <div style={{ fontSize: 13, marginTop: 12, opacity: 0.8 }}>
            SRU Event Hub · ข้อมูลส่วนบุคคลของท่านได้รับการคุ้มครองตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562
          </div>
        </div>
      </footer>
    </div>
  );
}
