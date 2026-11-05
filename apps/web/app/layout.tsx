import type { Metadata, Viewport } from 'next';
import { Sarabun } from 'next/font/google';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import '@/styles/globals.css';

const sarabun = Sarabun({
  subsets: ['thai', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-sarabun',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'SRU Event Hub – ระบบบริหารจัดการกิจกรรม มรส.', template: '%s | SRU Event Hub' },
  description: 'ระบบบริหารจัดการกิจกรรม มหาวิทยาลัยราชภัฏสุราษฎร์ธานี — ประชาสัมพันธ์ ลงทะเบียน และติดตามกิจกรรม',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#1f3a8a' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th" className={sarabun.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
