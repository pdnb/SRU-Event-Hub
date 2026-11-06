import { GroupInviteView } from '@/features/groups/GroupInviteView';

export const metadata = { title: 'ลิงก์เชิญเข้าร่วมกลุ่ม', robots: { index: false } };

export default function GroupInvitePage() {
  return (
    <div className="page-container" style={{ paddingTop: 24, maxWidth: 820 }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>ลงทะเบียนผ่านลิงก์เชิญของกลุ่ม</h1>
      <p style={{ color: '#6b7280', marginTop: 0 }}>ผู้ประสานงานกลุ่มส่งลิงก์นี้ให้ท่านเพื่อกรอกข้อมูลการเข้าร่วมกิจกรรมด้วยตนเอง</p>
      <GroupInviteView />
    </div>
  );
}
