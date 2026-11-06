# API (REST `/api/v1`)

เอกสารเต็ม (OpenAPI): `GET /api/docs` · JSON: `/api/docs/openapi.json` (ไม่เปิดใน production)

## มาตรฐาน
- Response สำเร็จ `{ "success": true, "data": …, "meta": { "page", "perPage", "total" } }`
- Error `{ "success": false, "error": { "code", "message", "details?", "requestId" } }` — client ตัดสินใจจาก `code`
- Status: 200/201, 400 (`IDEMPOTENCY_KEY_REQUIRED`), 401 (`UNAUTHORIZED`, `INVALID_CREDENTIALS`), 403 (`FORBIDDEN`, `CSRF_INVALID`), 404, 409 (`INVALID_STATE`, `VERSION_CONFLICT`, `DUPLICATE_REGISTRATION`, `EVENT_FULL`, `REGISTRATION_CLOSED`, `FEE_NOT_AVAILABLE`, `PAYMENT_EXPIRED`, `DUPLICATE_SLIP`, `PAYMENT_ALREADY_BATCHED`, `RECEIPT_EXISTS`, `RECEIPT_NO_TAKEN`, `SESSION_ALREADY_OPEN`), 413 (`FILE_TOO_LARGE`), 415 (`FILE_TYPE_NOT_ALLOWED`), 422 (`VALIDATION_ERROR` + details), 429
- Pagination `?page=&perPage=` (สูงสุด 100), ค้นหา `?search=`, เรียง `?order=asc|desc`
- เงินเป็น string ทศนิยม 2 ตำแหน่ง, วันที่ ISO-8601 UTC (ไม่บวก พ.ศ. ใน API)
- `Idempotency-Key` (8–100 ตัว) — คำขอซ้ำได้ผลเดิมพร้อม header `Idempotent-Replayed: true`
- Optimistic locking: `PATCH /events/:id` ต้องส่ง `version`

## Endpoints (P1)
```text
POST /auth/login · /auth/refresh · /auth/logout     GET /auth/me · /auth/providers · /auth/google(/callback)
GET  /organizations (public) · /organizations/admin · /organizations/:id
POST /organizations · /organizations/:id/deactivate · /organizations/:id/members   PATCH /organizations/:id   DELETE /organizations/:id/members/:memberId
GET  /users · /users/:id · /roles      POST /users · /users/:id/roles   PATCH /users/:id/status   DELETE /users/:id/roles/:grantId
GET  /lookups (public)                 POST/PATCH /event-categories · /event-types
GET  /public/events?tab=all|open|upcoming|past&categoryId&eventTypeId&organizationId&from&to&isPaid&featured&search
GET  /public/events/:idOrCode
GET  /events · /events/:id · /events/:id/status-history · /events/:id/approval-history
POST /events     PATCH /events/:id     DELETE /events/:id (ฉบับร่าง)
POST /events/:id/submit · approve · reject · return · publish · open-registration · close-registration · start · complete · reschedule · cancel
GET  /approvals/pending
POST /events/:id/registrations  (public, Idempotency-Key)
GET  /events/:id/registrations · /events/:id/registrations/export?format=xlsx|csv
GET  /me/registrations     POST /registrations/:id/cancel
POST /public/registrations/lookup · /public/registrations/cancel   (referenceNo + token ใน body)
GET  /health/live · /health/ready
```

## Endpoints (P2a การชำระเงินและการเงิน)
```text
POST /events (+ feeRates[], paymentWindowHours, bankAccountId, incomeCodeId) — การลงทะเบียนกิจกรรมมีค่าใช้จ่ายตอบกลับ payment (ใบแจ้งชำระ + PromptPay payload)
POST /public/registrations/slip      multipart: referenceNo, token, file, transferredAt?, note?
POST /registrations/:id/slip         multipart (เจ้าของการลงทะเบียนที่เข้าสู่ระบบ)
GET  /finance/options                บัญชีรับเงิน/รหัสรายได้ที่ใช้งาน (สำหรับฟอร์มกิจกรรม)
GET  /finance/payments?status&channel&eventId&search      GET /finance/payments/:id/slip (stream ผ่าน API)
POST /finance/payments/:id/verify · /finance/payments/:id/reject {reason}     POST /finance/orders/:id/waive {reason}
GET  /finance/batches · /finance/batches/eligible?eventId · /finance/batches/:id · /finance/batches/:id/export (xlsx)
POST /finance/batches {eventId, paymentIds?, note?} · /:id/submit · /:id/receive · /:id/return {reason} · /:id/receipts {receipts[]}
GET/POST/PATCH /finance/bank-accounts · /finance/income-codes
```

## Endpoints (P2b)
```text
GET  /finance/cashier-sessions?status&eventId      POST /finance/cashier-sessions {eventId, openingFloat?}
GET  /finance/cashier-sessions/:id · /:id/payables?search
POST /finance/cashier-sessions/:id/collect {orderId}   (Idempotency-Key บังคับ)
POST /finance/cashier-sessions/:id/close {countedAmount, note?} · /:id/remit {remittanceNo} · /:id/confirm
POST /finance/cashier-sessions/payments/:paymentId/void {reason}
GET  /finance/refunds?status · /finance/refunds/refundable?eventId&search
POST /finance/refunds {orderId, amount, reason, payeeName, bankName, accountNo} · /:id/approve · /:id/reject {reason} · /:id/pay {paidRef} · /:id/reveal-account
POST /finance/batches/receipts/:receiptId/void {reason}
GET  /audit-logs?action(prefix)&entityType&entityId&actorId&from&to&search · /audit-logs/actions
GET  /settings          PATCH /settings/:key {value}  (ต้องคงชนิดข้อมูลเดิม)
```

## Endpoints (P2c)
```text
GET  /finance/batches/:id/export?format=pdf|xlsx              รายงานนำส่ง (แม่แบบ finance.remittanceReportTemplate)
GET  /finance/cashier-sessions/:id/remittance-document?format=pdf|xlsx   ใบนำส่งเงินสด (หลังปิดกะ; แม่แบบ finance.cashRemittanceTemplate)
GET  /finance/cashier-sessions/:id/offline-pack · /:id/offline-sheet (PDF)   โหมดออฟไลน์ FIN-12
POST /finance/cashier-sessions/:id/collect {orderId, capturedAt?}   capturedAt = เวลารับเงินจริงของรายการที่บันทึกออฟไลน์ → 409 OFFLINE_CONFLICT ถ้าใบแจ้งไม่อยู่ในสถานะรอชำระแล้ว
GET  /finance/reconciliation/accounts · /template (CSV) · /statements?bankAccountId · /lines?bankAccountId&status&search&from&to · /lines/:id/candidates · /report?bankAccountId&from&to
POST /finance/reconciliation/statements (multipart: bankAccountId, file .csv/.xlsx) · /auto-match {bankAccountId}
POST /finance/reconciliation/lines/:id/match {paymentId} · /:id/unmatch {reason} · /:id/ignore {reason}     (finance_batch:reconcile)
POST /events/:id/fee-change {feeRates[], bankAccountId?, incomeCodeId?, reason} · GET /events/:id/fee-change · POST /events/:id/fee-change/cancel
PATCH /registrations/:id/billing {billing}  · POST /public/registrations/billing {referenceNo, token, billing}   (FIN-9)
POST /events/:id/registrations {..., billing?: {type: INDIVIDUAL|JURISTIC, name, taxId, branch, address}}
```
error code ใหม่: `STATEMENT_DUPLICATE`, `PAYMENT_ALREADY_MATCHED`, `APPROVAL_PENDING`, `OFFLINE_CONFLICT`

## Endpoints (P3a — ลงทะเบียนแบบกลุ่ม)
```text
# องค์กรผู้ส่งเข้าร่วม (ผู้ใช้ที่เข้าสู่ระบบสร้างได้ และเป็นผู้ประสานงาน)
GET  /me/participant-orgs        POST /participant-orgs {nameTh, orgType, taxId?, branch?, address?, province?, phone?, email?, position?}
PUT  /participant-orgs/:id       POST /participant-orgs/:id/coordinators {email, position?}   DELETE /participant-orgs/:id/coordinators/:userId
GET  /participant-orgs?verified&search (participant_org:view)   POST /participant-orgs/:id/verify · /:id/unverify (participant_org:approve, ห้ามผู้ประสานงานขององค์กรเอง)

# ตั้งค่ากลุ่มของกิจกรรม
GET  /public/events/:id/group-settings      PUT /events/:id/group-settings {isEnabled, minMembers, maxMembers, maxGroupsPerOrganization?, allowImport, allowInviteLinks, memberChangeCloseAt?} (group:update)
GET  /events/:id/groups?status&search (group:view; ไม่แสดงฉบับร่างเว้นแต่กรอง status=DRAFT)
GET  /events/:id/registrations?groupId=…   (ผลลัพธ์มี groupNo/groupName; export มีคอลัมน์เลขที่กลุ่ม/องค์กร)

# ผู้ประสานงาน
POST /events/:id/groups {participantOrganizationId, name, contactPhone?, note?}   (Idempotency-Key บังคับ)
GET  /me/groups · /groups/:id · /groups/:id/change-logs          PATCH /groups/:id {name?, contactPhone?, note?}
POST /groups/:id/members {participantTypeCode, firstName, lastName, email, phone?, …, answers?}
PUT  /groups/:id/members/:memberId {…, reason}   (หลังส่งกลุ่มต้องมีเหตุผล; เปลี่ยนประเภทผู้เข้าร่วมไม่ได้)
POST /groups/:id/members/:memberId/remove {reason?}   (หลังส่งกลุ่มต้องมีเหตุผล)
POST /groups/:id/submit {pdpaAttestation: true, billing?}   (Idempotency-Key บังคับ)
POST /groups/:id/cancel {reason?}   (ผู้จัดที่มี group:update ยกเลิกได้ ต้องระบุเหตุผล)
POST /groups/:id/slip (multipart file, transferredAt?, note?)    PATCH /groups/:id/billing {billing}
GET  /groups/:id/import-template (.xlsx)   POST /groups/:id/imports (multipart .xlsx) → ตรวจทุกแถว
GET  /groups/:id/imports/:importId   POST /groups/:id/imports/:importId/commit · /discard
POST /groups/:id/invitations {registrationId?, maxUses?, expiresInDays?} → token (แสดงครั้งเดียว)   POST /groups/:id/invitations/:invId/revoke

# ลิงก์เชิญ (ไม่ต้องเข้าสู่ระบบ; token ส่งใน body เท่านั้น)
POST /public/group-invitations/view {token}     POST /public/group-invitations/accept {token, pdpaConsent: true, …ข้อมูลสมาชิก}
```
error code ใหม่: `GROUP_DISABLED`, `GROUP_LIMIT`, `GROUP_FULL`, `GROUP_SEATS_UNAVAILABLE` (details: available, requested), `DUPLICATE_MEMBER`, `GROUP_MEMBER` (ยกเลิกรายคนไม่ได้ — ต้องผ่านกลุ่ม), `INVITATION_INVALID`, `INVITE_DISABLED`, `IMPORT_DISABLED`

## Endpoints (P3b — สมัครสมาชิก)
```text
POST /auth/register {email, password (≥10), displayName, phone?}  → 202 (คำตอบเหมือนกันเสมอ ไม่บอกว่าอีเมลมีบัญชีแล้วหรือไม่)
POST /auth/resend-verification {email} → 202     POST /auth/verify-email {token} → {verified, email}
GET  /auth/providers → {google, selfRegistration}
```
บัญชีที่สมัครเองเป็น `PENDING_VERIFICATION` จนกว่าจะยืนยันอีเมล — login ด้วยรหัสผ่านที่ถูกต้องได้ `403 EMAIL_NOT_VERIFIED` · อีเมลโดเมนมหาวิทยาลัย (`GOOGLE_ALLOWED_DOMAINS`) ได้ `USE_SSO` · ปิดการสมัครด้วย `SELF_REGISTRATION_ENABLED=false` และปิดอัตโนมัติใน production ถ้าไม่ได้ตั้ง `SMTP_URL`
