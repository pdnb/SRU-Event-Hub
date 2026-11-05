import { RegistrationStatusLookup } from '@/features/registration/RegistrationStatusLookup';

export const metadata = { title: 'ตรวจสอบสถานะการลงทะเบียน' };

export default function StatusPage() {
  return (
    <div className="page-container" style={{ paddingTop: 24, maxWidth: 720 }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>ตรวจสอบสถานะการลงทะเบียน</h1>
      <p style={{ color: '#6b7280', marginTop: 0 }}>กรอกเลขอ้างอิงและรหัสตรวจสอบที่ได้รับหลังลงทะเบียน หรือเปิดจากลิงก์ที่ได้รับ</p>
      <RegistrationStatusLookup />
    </div>
  );
}
