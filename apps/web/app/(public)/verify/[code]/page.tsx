import { VerifyCertificate } from '@/features/certificates/VerifyCertificate';

// The verification result depends on live data (a certificate can be revoked) — never cache, never index.
export const metadata = { title: 'ตรวจสอบเกียรติบัตร', robots: { index: false, follow: false } };

export default async function VerifyCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <VerifyCertificate code={decodeURIComponent(code).slice(0, 40)} />;
}
