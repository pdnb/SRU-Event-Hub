# ข้อกำหนดความต้องการ (SRS) — สรุปและการตรวจสอบย้อนกลับ

แหล่งข้อกำหนดหลัก: Master Development Prompt (ฉบับปรับปรุงที่รวมการชำระเงิน การลงทะเบียนกลุ่ม และป้ายชื่อ) — **หมายเหตุ:** สำเนาที่ทีมพัฒนาได้รับถูกตัดหลังหัวข้อ 12 (Seed Data) กรุณาแนบหัวข้อที่เหลือเพื่อปรับเอกสารนี้

| หัวข้อ spec | ระยะ | สถานะ / ตำแหน่งในโค้ด |
|---|---|---|
| §2 Tech stack | P1 | ดู [VERSIONS.md](VERSIONS.md) (NestJS 11, TS 5.9 ด้วยเหตุผลความเข้ากันได้) |
| §3 Monorepo | P1 | ✅ |
| §4.1 Auth & Users | P1 | ✅ `apps/api/src/auth`, `users` (สมัครเอง + ยืนยันอีเมล ✅ P3b `auth/signup.*`) |
| §4.2 Organizations | P1 | ✅ tree, หัวหน้า, สมาชิกตามบทบาท (PROPOSER/APPROVER/FINANCE_OFFICER) |
| §4.3 Events | P1 | ✅ ยกเว้นอัปโหลดรูป/ไฟล์ (P2 พร้อม storage service), ค่าลงทะเบียน ✅ P2a, ตั้งค่ากลุ่ม ✅ P3a (API) |
| §4.4 Approval | P1 | ✅ กำหนดขั้นเอง, สายบังคับบัญชา, ขั้นตรวจการเงิน, ประวัติ append-only; UI แก้ workflow → P5 (ปัจจุบันตั้งผ่าน seed/DB) |
| §4.5 Portal | P1 | ✅ หน้าแรก, ทั้งหมด/เปิดรับ/กำลังจัด/ย้อนหลัง, ปฏิทิน, รายละเอียด, ลงทะเบียน, ตรวจสถานะ, ค้นหา/กรอง, แนะนำ, แชร์ — หน้าชำระเงิน ✅ P2a, หน้ากลุ่ม ✅ P3b |
| §4.6 Registration | P1 | ✅ รายบุคคล, guest, ป้องกันซ้ำ, จำกัดที่นั่ง atomic, waitlist, idempotency, export — §4.6.1 กลุ่ม ✅ P3a `apps/api/src/groups` + หน้าเว็บ P3b `apps/web/features/groups` |
| §4.7 Payment & Finance | P2a ✅ / P2b ✅ / P2c ✅ | `apps/api/src/payments` — ดู [PAYMENT.md](PAYMENT.md) (แม่แบบเอกสารเป็นค่าชั่วคราว รอแบบฟอร์มจริง FIN-1) |
| §4.8 QR/Check-in, §4.8.1 Badges, §4.9 Attendance | P4 | ✅ API `apps/api/src/checkin`, `apps/api/src/badges` · เว็บ `/admin/checkin`, `/admin/badges` (designer `/admin/badges/templates/:id`), QR ผู้เข้าร่วมใน `/my/registrations`, หน้าตรวจสถานะ, หน้ากลุ่ม — สำเนา spec ไม่มีรายละเอียด §4.8+ จึงออกแบบตามขอบเขตใน ROADMAP (ดู OPEN_QUESTIONS CHK-*) |
| §4.10 Certificates, §4.11 Evaluation | P5a | ✅ API `apps/api/src/certificates`, `apps/api/src/evaluations` · เว็บ `/admin/certificates`, `/admin/evaluations`, `/my/certificates`, `/my/evaluations`, `/verify`, ส่วนท้ายหน้าตรวจสถานะ (guest) — สำเนา spec ไม่มีรายละเอียด §4.10+ จึงออกแบบตามขอบเขตใน ROADMAP (ดู OPEN_QUESTIONS CERT-*, EVAL-1) |
| §4.12 Notifications | P2b–P5 | ตารางพร้อม, โครง BullMQ พร้อม (ใช้กับหมดเวลาชำระแล้ว) |
| §4.13 Venues | P1 schema / P5 UI | ✅ ตาราง + exclusion constraint กันจองซ้อน |
| §4.14 Dashboard | P1 พื้นฐาน / P5 ตามบทบาท | |
| §5 RBAC | P1 | ✅ 15 บทบาท, permission ระดับ action รวม finance actions, data scope, SoD |
| §6 Database | P1 | ✅ ดู [DATABASE.md](DATABASE.md) |
| §7 UI/UX | P1 | ✅ Sarabun, พ.ศ., responsive, page header/breadcrumb/states, สีสถานะมาตรฐาน — สีแบรนด์รอยืนยัน (UI-1) |
| §8 API | P1 | ✅ ดู [API.md](API.md) |
| §9 Security | P1 | ✅ ดู [SECURITY.md](SECURITY.md) |
| §10 Performance | P1 บางส่วน | row lock ต่อกิจกรรม, index, pagination; Redis cache/queue → P2 |
| §11 Workflow | P1 | ✅ กิจกรรม + อนุมัติ + ลงทะเบียน ([WORKFLOW.md](WORKFLOW.md)) |
| §12 Seed | P1 | ✅ มหาวิทยาลัย คณะ/สำนัก/กองคลัง, บัญชีทุกบทบาท, ประเภท/หมวด/ประเภทผู้เข้าร่วม, สถานที่, workflow, กิจกรรมตัวอย่าง — บัญชีรับเงิน/รหัสรายได้ ✅ (ค่าตัวอย่าง) |
