# แผนการพัฒนาแบ่งระยะ (Roadmap)

ระบบตาม Master Prompt มีขนาดใหญ่ (30+ โมดูล) จึงพัฒนาเป็นระยะ แต่ละระยะส่งมอบซอฟต์แวร์ที่ใช้งานได้จริง ผ่านการทดสอบ และมี migration ของตนเอง

| ระยะ | ขอบเขต | สถานะ |
|---|---|---|
| **P1 Foundation** | Monorepo, infra (Docker/Nginx), Auth (password + Google OIDC, refresh rotation, lockout), RBAC + Data Scope, หน่วยงาน, ผู้ใช้, ประเภท/หมวดหมู่, กิจกรรม + state machine, Workflow อนุมัติแบบกำหนดเอง, Portal สาธารณะ (ค้นหา/กรอง/ปฏิทิน/แชร์), ลงทะเบียนรายบุคคล (atomic, idempotent, waitlist, guest, ตรวจสถานะด้วย token), Export Excel/CSV, Audit log, utility การเงิน (บาทถ้วน, PromptPay, ปีงบประมาณ) | ✅ เสร็จ |
| **P2a Payment core** | อัตราค่าลงทะเบียน (ตามประเภท/ช่วงเวลา, snapshot), ใบแจ้งชำระ + PromptPay QR, แนบสลิป (magic number, private bucket, SHA-256 ซ้ำ), ตรวจ/ไม่ผ่าน/ยกเว้น (SoD), หมดเวลา (BullMQ delayed + sweeper) + เลื่อนรายชื่อสำรอง, ledger append-only + trigger ห้ามแก้ยอด, ขั้นตรวจสอบการเงินในการอนุมัติ, ชุดนำส่งกองคลัง + Excel, เลขที่ใบเสร็จ, บัญชีรับเงิน/รหัสรายได้ | ✅ เสร็จ |
| **P2b Finance operations** | กะรับเงินหน้างาน, ใบนำส่งเงินสด, คืนเงิน, ยกเลิกใบเสร็จ, PDF ตามแบบฟอร์มกองคลัง, กระทบยอด, FEE_CHANGE re-approval, Audit log UI, ตั้งค่าระบบ, Redis-backed throttling, ESLint | ถัดไป |
| **P3 Group Registration** | องค์กรผู้ส่งเข้าร่วม, ผู้ประสานงาน, ตั้งค่ากลุ่ม, นำเข้า Excel, ลิงก์เชิญ, สำรองที่นั่งทั้งกลุ่มแบบ atomic, ใบแจ้งชำระรวม, PDPA consent | |
| **P4 Check-in & Badges** | QR token, สแกน, หลายจุด, real-time (Socket.IO), Group check-in, Attendance, Template designer + PDF engine, พิมพ์ป้ายชื่อชุด/ทันที/ซ้ำ | |
| **P5 Certificates, Evaluation, Venues, Reports** | เกียรติบัตร + ตรวจสอบสาธารณะ, แบบประเมิน, สถานที่/ทรัพยากร UI, Dashboard ตามบทบาท, รายงาน, การแจ้งเตือน Email/LINE, Playwright E2E | |

หมายเหตุ: ตารางฐานข้อมูลของ P2–P5 ถูกออกแบบไว้ใน [DATABASE.md](DATABASE.md) และจะเพิ่มผ่าน migration ของแต่ละระยะ
