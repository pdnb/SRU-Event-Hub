# การชำระเงินและการเงิน (ออกแบบสำหรับระยะที่ 2)

## สิ่งที่พร้อมแล้วใน P1
- `@sru/shared-utils` (มี unit test): เงินแบบจำนวนเต็มสตางค์ (BigInt) ไม่มี floating point, `bahtText()` (บาทถ้วน/สตางค์), `promptPayPayload()` EMVCo + CRC16 (ทดสอบเทียบไลบรารีอ้างอิงแบบ byte-for-byte), `fiscalYearBE()` (1 ต.ค.–30 ก.ย. ตามเวลากรุงเทพฯ), `formatReference('PAY', 2570, n)` → `PAY-2570-000123`, `sanitizeSpreadsheetCell()`
- `document_sequences` สำหรับเลขที่เอกสารตามปีงบประมาณ, Idempotency-Key, audit append-only trigger, `events.is_paid` (ปัจจุบันระบบปฏิเสธการลงทะเบียนกิจกรรมที่มีค่าใช้จ่ายด้วย `PAID_REGISTRATION_UNAVAILABLE` จนกว่าจะเปิดโมดูลนี้)

## หลักการ (spec §4.7)
1. ใบเสร็จทางราชการออกโดยกองคลังเท่านั้น — ระบบออกได้เพียง "หลักฐานการชำระเงิน (ไม่ใช่ใบเสร็จรับเงิน)"
2. ยอดเงินคำนวณที่ backend จาก snapshot อัตรา ณ เวลาสร้างใบแจ้งชำระ
3. ข้อมูลการเงิน append-only — แก้ไขด้วยรายการกลับ (reversal) พร้อมเหตุผล, ห้าม UPDATE/DELETE ยอด (trigger + service)
4. แยกสถานะ: ใบแจ้งชำระ / รายการชำระ / ใบเสร็จ / ชุดนำส่ง / กะรับเงิน (มี enum ใน `@sru/shared-types`)
5. Separation of duties: ผู้ตรวจสลิป ≠ ผู้ชำระ, ผู้อนุมัติยกเลิกรับเงิน ≠ ผู้รับเงิน, ผู้รับชุดนำส่ง ≠ ผู้จัดทำ

## แผนการพัฒนา P2
- ใบแจ้งชำระ + กันที่นั่ง PENDING_PAYMENT, หมดเวลา: BullMQ delayed job + sweeper ทุก 5 นาที, ใช้ row lock เมื่อสลิปเข้ามาพร้อมหมดเวลา (แนบสลิปก่อนครบกำหนด → ไม่ตัดสิทธิ์ระหว่างรอตรวจ)
- อัปโหลดสลิป: private bucket, ตรวจ magic number (JPG/PNG/PDF), จำกัดขนาด, unique SHA-256, presigned URL อายุสั้น
- ชุดนำส่งกองคลัง: snapshot JSON + คอลัมน์ค้นหา, รายการหนึ่งอยู่ในชุดที่ใช้งานได้เพียงชุดเดียว (partial unique), export PDF (ฟอนต์ Sarabun, พ.ศ.) / Excel ตามแบบฟอร์มที่ตั้งค่าได้
- เลขที่ใบเสร็จ: ทีละรายการ / ช่วงเลข / นำเข้า Excel, unique (ปีงบ, เล่ม, เลขที่)
- กะรับเงินหน้างาน, ใบนำส่งเงินสด, กระทบยอดหลังกิจกรรม, คืนเงิน (บัญชีเข้ารหัส AES-256-GCM แสดงแบบปิดบัง)
- Adapter ตรวจสลิปอัตโนมัติ / Payment Gateway — ปิดเป็นค่าเริ่มต้น

ประเด็นที่ต้องยืนยันกับกองคลัง: [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) FIN-1 ถึง FIN-12
