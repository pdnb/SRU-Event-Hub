import { Suspense } from 'react';
import { LoginForm } from '@/features/auth/LoginForm';
import { brand } from '@/styles/theme';

export const metadata = { title: 'เข้าสู่ระบบ' };

export default function LoginPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16, background: `linear-gradient(135deg, ${brand.sidebar}, ${brand.primary})` }}>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
