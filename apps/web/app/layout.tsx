import type { Metadata, Viewport } from 'next';
import { Anuphan } from 'next/font/google';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import '@/styles/globals.css';

const anuphan = Anuphan({
  subsets: ['thai', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-anuphan',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'SRU Event Hub – ระบบบริหารจัดการกิจกรรม มรส.', template: '%s | SRU Event Hub' },
  description: 'ระบบบริหารจัดการกิจกรรม มหาวิทยาลัยราชภัฏสุราษฎร์ธานี — ประชาสัมพันธ์ ลงทะเบียน และติดตามกิจกรรม',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0284c7' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th" className={anuphan.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
