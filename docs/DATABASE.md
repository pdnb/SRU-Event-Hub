# ฐานข้อมูล

PostgreSQL 17 + Prisma 7 (multi-file schema: `apps/api/prisma/schema/*.prisma`)

## หลักการ
- PK เป็น UUID v7 (เรียงตามเวลา เป็นมิตรกับ index), ชื่อตาราง/คอลัมน์ snake_case
- เวลาเป็น `timestamptz`, เงินเป็น `Decimal(12,2)` (ส่งใน JSON เป็น string `"1500.00"`)
- `created_at/updated_at/created_by_id/updated_by_id`; soft delete (`deleted_at`) เฉพาะ users/organizations/events/files — **ห้ามใช้กับข้อมูลการเงิน**
- เปลี่ยน schema ผ่าน migration เสมอ (`prisma migrate dev --create-only` แล้วเพิ่ม SQL ที่ Prisma แสดงไม่ได้)

## ตารางที่มีแล้ว (migration `init`)
identity: `users, user_profiles, auth_identities, refresh_tokens, login_history, roles, permissions, role_permissions, user_roles`
organization: `organizations, user_organizations`
event: `event_types, event_categories, tags, event_tags, participant_types, events, event_participant_types, event_images, event_files, event_schedules, event_organizers, event_status_history`
approval: `approval_workflows, approval_steps, approval_requests, approval_actions`
registration: `registration_fields, registration_field_options, registrations, registration_answers, waiting_lists`
venue: `buildings, venues, resources, venue_bookings, resource_bookings`
system: `files, audit_logs, activity_logs, system_settings, document_sequences, idempotency_keys, notifications, notification_templates, notification_logs`

## Constraint นอก Prisma (อยู่ใน `migrations/*_init/migration.sql`)
| ชื่อ | วัตถุประสงค์ |
|---|---|
| `registrations_event_email_active_key` | partial unique `(event_id, email_normalized)` WHERE status ∈ {PENDING_PAYMENT, CONFIRMED, WAITLISTED} — กันสมัครซ้ำแม้ส่งพร้อมกัน |
| `registrations_email_normalized` | CHECK `email_normalized = lower(btrim(email))` |
| `events_seats_within_capacity` | CHECK `seats_taken <= capacity` (ด่านที่สองกัน overbooking) |
| `events_*` | CHECK เวลาเริ่ม<สิ้นสุด, ช่วงรับสมัคร, budget ≥ 0 |
| `user_roles_user_role_org_key` | unique `NULLS NOT DISTINCT` — ประกาศ `@@unique(..., map:)` ชื่อเดียวกันใน schema ด้วย ไม่เช่นนั้น `prisma migrate dev` จะสร้าง migration ที่ DROP index นี้ (ห้าม commit migration แบบนั้น) |
| `users_email_lower_key`, `users_username_lower_key` | unique แบบไม่สนตัวพิมพ์ |
| `venue_bookings_no_overlap` | EXCLUDE USING gist — ห้องเดียวกันห้ามจองซ้อน (เฉพาะ APPROVED) |
| `events_public_listing_idx` | partial index สำหรับหน้า portal |
| trigger `forbid_update_delete()` | append-only: `audit_logs`, `approval_actions`, `event_status_history` (P2 ใช้กับ `payment_ledger_entries`, `finance_batch_items` ที่ส่งแล้ว) |

## การกันที่นั่งเกิน (Concurrency)
ลงทะเบียน = transaction เดียว: `SELECT … FROM events WHERE id=$1 FOR UPDATE` → ตรวจสถานะ/ช่วงเวลา/ที่นั่ง → `seats_taken += n` หรือเข้าคิวสำรอง → สร้าง registration. ยกเลิกล็อกลำดับเดียวกัน (registration → event) แล้วเลื่อนผู้สำรองแบบ FIFO ใน transaction เดียวกัน. ทดสอบด้วย e2e ส่ง 12 คำขอพร้อมกัน

`seats_taken` นับ PENDING_PAYMENT + CONFIRMED (spec §4.6) — การลงทะเบียนกลุ่ม (P3) จองทั้งก้อนด้วย `n = จำนวนสมาชิก` ในคำสั่งเดียว

## เลขเอกสาร
`document_sequences(prefix, fiscal_year)` + `INSERT … ON CONFLICT DO UPDATE … RETURNING` ภายใน transaction ธุรกรรม → ไม่ซ้ำ ไม่ข้าม เช่น `EVT-2570-000001`, `REG-…`, `INV-…` (ใบแจ้งชำระ), `PAY-…` (รายการชำระ), `FB-…` (ชุดนำส่ง)

## Migration `finance` (P2a)
ตาราง: `bank_accounts`, `income_codes`, `event_fee_rates`, `payment_orders`, `payments`, `payment_ledger_entries`, `finance_batches`, `finance_batch_items`, `receipt_records` + คอลัมน์ `events.payment_window_hours / bank_account_id / income_code_id`

Constraint/trigger เพิ่มเติม (เขียนเองใน migration):
- CHECK จำนวนเงิน (`> 0` สำหรับใบแจ้งชำระ/รายการชำระ/รายการในชุด/ใบเสร็จ, `>= 0` สำหรับอัตรา), ช่วงเวลาอัตรา, `payment_window_hours` 1–720
- Partial unique: ใบแจ้งชำระที่ยังมีผล 1 ใบต่อการลงทะเบียน · รายการรอตรวจสอบ 1 รายการต่อใบแจ้ง · `slip_sha256` ห้ามซ้ำในรายการที่ยังมีผล · รายการชำระอยู่ในชุดนำส่งที่ใช้งานได้ชุดเดียว · ใบเสร็จที่ไม่ถูกยกเลิก 1 ใบต่อรายการ
- `payment_ledger_entries` append-only (ใช้ `forbid_update_delete()`)
- `forbid_amount_change()`: ห้ามแก้ `amount` และห้ามลบแถวใน `payment_orders, payments, finance_batch_items, receipt_records`
- `forbid_batch_total_change()`: ยอดรวม/จำนวนรายการของ `finance_batches` แก้ไม่ได้ และลบไม่ได้

## Migration `cashier_refund` (P2b)
ตาราง: `cashier_sessions` (+ `payments.cashier_session_id`), `refunds`
- Partial unique: กะ OPEN ได้ 1 กะต่อผู้รับเงินต่อกิจกรรม
- `forbid_cashier_total_change()`: ยอดที่ระบบ/ยอดนับได้ตอนปิดกะ และเงินทอนตั้งต้นแก้ไม่ได้, ลบกะไม่ได้
- `refunds.amount` แก้ไม่ได้/ลบไม่ได้ (`forbid_amount_change()`), `account_no_enc` เก็บแบบ AES-256-GCM

ลำดับการล็อกแถว (กัน deadlock): registration → event / cashier_session → payment_order → payment

## Migration `finance_p2c` (P2c)
ตาราง: `bank_statements`, `bank_statement_lines` · คอลัมน์: `payment_orders.billing_*` (FIN-9), `payments.captured_offline_at` (FIN-12), `approval_requests.payload / reason` (FEE_CHANGE) · enum `ApprovalStatus` + `CANCELLED`
- `approval_requests_one_pending_per_event`: partial unique — คำขออนุมัติที่ PENDING ได้ 1 รายการต่อกิจกรรม
- `payment_orders_billing_chk`: JURISTIC ต้องมีชื่อและเลขผู้เสียภาษี 13 หลัก (checksum ตรวจที่ API)
- `bank_statements`: append-only (`forbid_update_delete()`), unique (บัญชี, SHA-256 ไฟล์)
- `bank_statement_lines`: `amount > 0` และแก้/ลบไม่ได้ (`forbid_amount_change()`), unique (บัญชี, fingerprint) กันนำเข้ารายการซ้ำจากไฟล์ที่ช่วงเวลาทับกัน, CHECK สถานะ AUTO/MANUAL ⇔ มี payment_id, partial unique `payment_id` WHERE AUTO/MANUAL (1 รายการชำระจับคู่ได้ 1 บรรทัด)
- การจับคู่ทุกครั้งล็อกแถว `bank_accounts` ของบัญชีนั้นก่อน

## Migration `group_registration` (P3a)
ตาราง: `participant_organizations`, `organization_coordinators`, `event_group_settings`, `registration_groups`, `group_member_invitations`, `group_imports`, `group_import_rows`, `group_change_logs`, `group_consents`, `payment_order_lines` · คอลัมน์: `registrations.group_id`, `payment_orders.group_id` · enum `RegistrationStatus` + `DRAFT`
- สมาชิกกลุ่มคือแถวใน `registrations` (`source = GROUP`): `DRAFT` = ยังไม่ส่งกลุ่ม ไม่ถือที่นั่ง ไม่อยู่ใน partial unique ของอีเมล (ตรวจซ้ำตอนส่ง และ index จับซ้ำอีกชั้นเมื่อเปลี่ยนสถานะ) และใช้เลขอ้างอิงชั่วคราว `DRAFT-…` — ได้เลข `REG-` ตอนส่ง (ลำดับเลขไม่ข้าม)
- `payment_orders_payer_xor`: CHECK ใบแจ้งชำระเป็นของการลงทะเบียน **หรือ** กลุ่มอย่างใดอย่างหนึ่ง · `payment_orders_one_live_per_group`: ใบแจ้งที่ยังมีผล 1 ใบต่อกลุ่ม
- `payment_order_lines`: ค่าลงทะเบียนรายคน (snapshot) แก้/ลบไม่ได้ (`forbid_amount_change()`), `amount >= 0`
- `group_change_logs`, `group_consents`: append-only (`forbid_update_delete()`)
- CHECK: จำนวนสมาชิก min/max, จำนวนครั้งใช้ลิงก์เชิญ, เลขผู้เสียภาษีองค์กร 13 หลัก
- ลำดับการล็อก: `registration_groups` → `events` → `payment_orders` → `payments` (ตรงกับ registration → event → order ของรายบุคคล — `lockPayer()` ใน payments.service)

## Migration `email_verification` (P3b)
ตาราง `email_verifications` (เก็บ SHA-256 ของ token, ใช้ครั้งเดียว, หมดอายุ 24 ชม.) · ประกาศ `@@index` ของ `group_import_rows.registration_id` ใน schema เพื่อไม่ให้ `prisma migrate dev` สร้างคำสั่ง DROP

## Migration `checkin_badges` (P4)
ตาราง: `checkin_locations`, `checkin_tokens`, `checkin_records`, `attendance_records`, `event_personnel`, `badge_templates`, `badge_template_fields`, `badge_color_rules`, `badge_print_jobs`, `badge_prints` · คอลัมน์ `events.checkin_opens_before_minutes` (0–10080, ค่าเริ่มต้น 120), `events.checkin_late_after_minutes` (null = ไม่นับสาย)
- `checkin_tokens`: เก็บ SHA-256 ของ token เท่านั้น (token = HMAC จาก id ด้วยคีย์ที่ derive จาก `FIELD_ENCRYPTION_KEY` ผ่าน HKDF) · CHECK registration XOR group · partial unique token ที่ยังใช้ได้ 1 อันต่อการลงทะเบียน/กลุ่ม
- `checkin_records`: append-only (`forbid_update_delete()`) · `client_key` unique (idempotent สำหรับ offline sync) · การยกเลิกเป็นแถว `UNDO` ที่อ้าง `undoes_id` (unique — ยกเลิกซ้ำไม่ได้; CHECK action=UNDO ⇔ มี undoes_id)
- `attendance_records`: unique `(registration_id, schedule_id) NULLS NOT DISTINCT` (schedule NULL = ทั้งกิจกรรม; ประกาศ map ชื่อเดียวกันใน schema กัน DROP) — คำนวณใหม่จาก records ทุกครั้ง; `is_manual` = เจ้าหน้าที่กำหนด (สแกนจริงภายหลังทับค่า)
- `badge_prints`: append-only · CHECK registration XOR personnel · unique (subject, print_no) กันสองจุดพิมพ์ป้าย "ครั้งแรก" ซ้ำพร้อมกัน · `badge_print_jobs.template_snapshot` (JSON) ทำให้เปิดไฟล์ซ้ำได้ป้ายเหมือนเดิมแม้แก้แม่แบบ · CHECK REPRINT ต้องมีเหตุผล
- `badge_templates`: CHECK ขนาด 20–300 มม. · partial unique แม่แบบหลัก 1 อันต่อกิจกรรม
- ลำดับการล็อก: เช็กอินล็อกเฉพาะแถว `registrations` (ไม่แตะที่นั่ง จึงไม่ deadlock กับการลงทะเบียน/ชำระเงิน)

## Migration `certificates_evaluation` (P5a)
ตาราง: `certificate_templates`, `certificates`, `certificate_verifications`, `evaluation_forms`, `evaluation_questions`, `evaluation_options`, `evaluation_responses`, `evaluation_answers`
- `certificates`: เลขที่ `CERT-<ปีงบ>-nnnnnn` (sequence ไม่ข้าม) + `verify_code` 12 ตัว Crockford base32 (สุ่ม 60 บิต, CHECK รูปแบบ) · CHECK registration XOR personnel · partial unique ฉบับ ISSUED 1 ฉบับต่อ (แม่แบบ, ผู้รับ) · `data` + `template_snapshot` (JSON) ทำให้ PDF/หน้าตรวจสอบแสดงสิ่งที่ออกจริงเสมอ
- trigger `forbid_certificate_change()`: ห้ามแก้เนื้อหาที่ออกแล้ว ห้ามลบ และฉบับที่ยกเลิกกลับมาใช้ไม่ได้ — แก้ได้เฉพาะ ISSUED→REVOKED (เหตุผล ≥3 ตัวอักษร, CHECK) และตัวนับการดาวน์โหลด
- การออก/รับเอง ล็อกแถว `certificate_templates` (`FOR UPDATE`) แล้วตรวจซ้ำใน transaction → หลายจุด/กดซ้ำไม่ออกซ้ำ และเลขที่ไม่ข้าม
- `certificate_verifications`: append-only, IP เก็บเป็น HMAC เท่านั้น
- `evaluation_responses`: `respondent_key` = HMAC(form id + registration id) unique ต่อแบบประเมิน → ตอบได้ครั้งเดียวแม้ไม่ระบุตัวตน (ไม่เก็บ `registration_id`) · responses/answers append-only · CHECK คำตอบมีค่าเดียว (option / ตัวเลข / ข้อความ), `scale_max` 2–10, เวลาเปิด < ปิด

## ตารางระยะถัดไป (ออกแบบตาม spec §6)
- **Payment & Finance (ส่วนที่เหลือ)**: `receipt_stocks` — ข้อมูลออกใบเสร็จ (P2c) เก็บเป็นคอลัมน์ `payment_orders.billing_*` แทนตาราง `billing_infos`
