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
| `user_roles_user_role_org_key` | unique `NULLS NOT DISTINCT` |
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

ลำดับการล็อกแถว (กัน deadlock): registration → event → payment_order → payment

## ตารางระยะถัดไป (ออกแบบตาม spec §6)
- **P2b Payment & Finance (ส่วนที่เหลือ)**: `billing_infos, payment_order_lines (ใบแจ้งรวมของกลุ่ม P3: CHECK registration_id XOR group_id), cashier_sessions, cash_remittances, receipt_stocks, refunds (บัญชีเข้ารหัส AES-256-GCM), bank_statement_imports, bank_statement_lines`
- **P3 Group**: `participant_organizations, organization_coordinators, event_group_settings, registration_groups, group_member_invitations (hash token), group_imports, group_import_rows, group_change_logs, group_consents` + `registrations.group_id`
- **P4**: `checkin_tokens, checkin_records, checkin_locations, attendance_records, badge_templates, badge_template_fields, badge_color_rules, badge_print_jobs, badge_prints, event_personnel`
- **P5**: `certificate_templates, certificates, certificate_verifications, evaluation_forms, evaluation_questions, evaluation_options, evaluation_responses, evaluation_answers`
