import { VerifyEmail } from '@/features/auth/VerifyEmail';
import { brand } from '@/styles/theme';

export const metadata = { title: 'ยืนยันอีเมล', robots: { index: false } };

export default function VerifyEmailPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16, background: `linear-gradient(135deg, ${brand.sidebar}, ${brand.primary})` }}>
      <VerifyEmail />
    </div>
  );
}
