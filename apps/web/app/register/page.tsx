import { Suspense } from 'react';
import { SignupForm } from '@/features/auth/SignupForm';
import { brand } from '@/styles/theme';

export const metadata = { title: 'สมัครสมาชิก' };

export default function RegisterPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16, background: `linear-gradient(135deg, ${brand.sidebar}, ${brand.primary})` }}>
      <Suspense>
        <SignupForm />
      </Suspense>
    </div>
  );
}
