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

## Endpoints (P4 — เช็กอิน การเข้าร่วม ป้ายชื่อ)
```text
# QR (ข้อความ QR = "SRU1.<token 22 ตัว>")
GET  /registrations/:id/checkin-qr          (เจ้าของ หรือ checkin:view) → {code, referenceNo, status}  เฉพาะ CONFIRMED / PENDING_PAYMENT
POST /public/registrations/checkin-qr {referenceNo, token}   (ไม่ต้องเข้าสู่ระบบ; จำกัด 10/นาที)
GET  /groups/:id/checkin-qr                 (ผู้ประสานงาน หรือ checkin:view) — QR กลุ่ม
POST /registrations/:id/checkin-qr/reissue {reason}   (checkin:update) — QR เดิมใช้ไม่ได้ทันที

# จุดเช็กอิน
GET  /me/desk-events?purpose=checkin|badge  — กิจกรรมที่เปิดจุด/พิมพ์ป้ายได้ (ตามขอบเขต + บุคลากรที่ได้รับมอบหมาย)
GET  /events/:id/checkin/settings           PUT /events/:id/checkin/settings {opensBeforeMinutes, lateAfterMinutes?}
POST /events/:id/checkin/locations {nameTh, scheduleId?}   PATCH /checkin/locations/:id {nameTh?, scheduleId?, isActive?}
POST /events/:id/schedules {title, startAt, endAt, venueText?}   PUT/DELETE /event-schedules/:id   (event:update)
POST /events/:id/checkin/scan {code, locationId?, scheduleId?, action?: CHECK_IN|CHECK_OUT, clientKey?}
       → {kind: REGISTRATION, outcome: CHECKED_IN|ALREADY_CHECKED_IN|CHECKED_OUT, registration, attendance, record}
       → {kind: GROUP, group: {members…}}   (QR กลุ่ม: ยังไม่เช็กอินใคร)
POST /events/:id/checkin/manual {registrationId, …point, note?}
POST /events/:id/checkin/group {groupId, registrationIds[], locationId?, scheduleId?}  → ผลรายคน
GET  /events/:id/checkin/search?q=          GET /events/:id/checkin/groups/:groupId?scheduleId=
POST /checkin/records/:id/undo {reason}     (checkin:update)
GET  /events/:id/checkin/records?locationId&registrationId&search     GET /events/:id/checkin/stats
GET  /events/:id/checkin/offline-pack       → รายชื่อ + SHA-256 ของ token (ไม่มี token จริง)
POST /events/:id/checkin/sync {items:[{clientKey, registrationId, occurredAt, locationId?, scheduleId?, action?}]}  (≤500, ย้อนหลังไม่เกิน 72 ชม.)

# การเข้าร่วม
GET  /events/:id/attendance?scheduleId&status&participantTypeId&search   (attendance:view; meta.summary)
PUT  /events/:id/attendance/:registrationId {status, note, scheduleId?}  (attendance:update)
GET  /events/:id/attendance/export?scheduleId   (attendance:export, .xlsx)

# บุคลากรของงาน
GET  /events/:id/personnel (badge:view)   POST /events/:id/personnel · PATCH/DELETE /event-personnel/:id (event:update)
GET  /events/:id/personnel/user-lookup?email=

# ป้ายชื่อ
GET  /badges/placeholders     GET /events/:id/badge-templates     POST /events/:id/badge-templates {nameTh, paper, widthMm, heightMm, fields?, colorRules?}
GET/PUT/DELETE /badge-templates/:id   (PUT ต้องส่ง version — 409 VERSION_CONFLICT)
POST /badge-templates/:id/background (multipart PNG/JPG ≤5MB)   GET /badge-templates/:id/background
POST /events/:id/badge-templates/preview {template, templateId?} → PDF
GET  /events/:id/badges/candidates?kind=registration|personnel&printed=yes|no&participantTypeId&groupId&search
POST /events/:id/badge-print-jobs {templateId, mode: BATCH|INSTANT|REPRINT, registrationIds?, personnelIds?, filter?: {participantTypeIds, groupId, includePrinted, includePersonnel}, reason?}
GET  /events/:id/badge-print-jobs     GET /badge-print-jobs/:id/pdf (badge:print; เปิดซ้ำถูกนับ + audit)
GET  /registrations/:id/badge-history · /event-personnel/:id/badge-history
```
error code ใหม่: `INVALID_QR`, `QR_NOT_FOUND`, `QR_REVOKED`, `WRONG_EVENT`, `EVENT_NOT_ACTIVE`, `CHECKIN_NOT_OPEN`, `CHECKIN_CLOSED`, `PAYMENT_PENDING`, `NOT_CONFIRMED`, `REGISTRATION_INACTIVE`, `NOT_CHECKED_IN` (มี `details.registration` ให้จุดเช็กอินเห็นว่าเป็นใคร), `ALREADY_PRINTED`, `VERSION_CONFLICT`

Real-time: Socket.IO namespace `/checkin` (path `/socket.io`) — ยืนยันตัวตนด้วย cookie `sru_at` (หรือ `auth.token`), `emit('subscribe', {eventId})` → `{ok}` (ตรวจ `checkin:view` ทุกครั้ง), รับ `checkin` {eventId, kind, count, at} — ไม่มีข้อมูลส่วนบุคคล ให้ client ดึง /stats ใหม่

## Endpoints (P5a — แบบประเมิน เกียรติบัตร)
```text
# แบบประเมิน (ผู้จัด)
GET  /events/:id/evaluation-forms (evaluation:view)    POST /events/:id/evaluation-forms {titleTh, questions?, isAnonymous?, requireAttendance?, requiredForCertificate?, opensAt?, closesAt?}
GET/PUT/DELETE /evaluation-forms/:id   (PUT ต้องส่ง version; มีผู้ตอบแล้ว → แก้คำถาม/การไม่ระบุตัวตนไม่ได้ และลบไม่ได้)
POST /evaluation-forms/:id/status {status: PUBLISHED|CLOSED}
GET  /evaluation-forms/:id/summary      GET /evaluation-forms/:id/export (evaluation:export, .xlsx)
# แบบประเมิน (ผู้ตอบ)
GET  /me/evaluations     GET /evaluation-forms/:id/respond?registrationId=     POST /evaluation-forms/:id/responses {registrationId, answers:[{questionId, value?|optionIds?|text?}]}
POST /public/registrations/evaluations {referenceNo, token}   POST /public/evaluation-forms/:id/view {…}   POST /public/evaluation-forms/:id/responses {…, answers}

# เกียรติบัตร (ผู้จัด)
GET  /certificates/placeholders    GET/POST /events/:id/certificate-templates    POST /events/:id/certificate-templates/preview {template, templateId?} → PDF
GET/PUT/DELETE /certificate-templates/:id (PUT ต้องส่ง version)    POST|GET /certificate-templates/:id/background (PNG/JPG ≤8MB)
GET  /events/:id/certificates/candidates?templateId&filter=eligible|ineligible|issued|not_issued&search   (meta.summary)
POST /events/:id/certificates/issue {templateId, ids? | allEligible?, overrideReason?}   (overrideReason ต้องมี certificate:update)
GET  /events/:id/certificates?templateId&status&search    GET /events/:id/certificates/export (.xlsx)    POST /events/:id/certificates/pdf {templateId?, ids?} (≤500)
POST /certificates/:id/revoke {reason}  (certificate:void)    GET /certificates/:id/pdf  (ผู้รับ หรือ certificate:view; ฉบับยกเลิกมีลายน้ำ)
# เกียรติบัตร (ผู้รับ)
GET  /me/certificates → {issued, claimable[{eligible, reasons}]}    POST /me/certificates/claim {templateId, registrationId}
POST /public/registrations/certificates {referenceNo, token}   …/certificates/claim {…, templateId}   …/certificates/pdf {…, certificateId}
# ตรวจสอบสาธารณะ (จำกัด 30/นาที)
GET  /public/certificates/verify/:code → {result: VALID|REVOKED|NOT_FOUND, certificateNo, recipientName, title, issuedAt, revokedAt, event}
GET  /me/desk-events?purpose=certificate|evaluation  (ตามขอบเขตสิทธิ์ ย้อนหลัง 1 ปี)
```
error code ใหม่: `NOT_ELIGIBLE` (details: ineligible[{id, fullName, reasons}] หรือ reasons), `ALREADY_ANSWERED`

## Endpoints (P5b — สถานที่ อุปกรณ์ การแจ้งเตือน)
```text
# แคตตาล็อก (venue:view; แก้ไขต้องมี venue:create|update ในขอบเขตหน่วยงานผู้ดูแล — ส่วนกลางต้องมีขอบเขต ALL)
GET  /buildings    POST /buildings    PATCH /buildings/:id
GET  /venues?search&buildingId&venueType&minCapacity&includeInactive    GET /venues/:id    POST /venues    PATCH /venues/:id
GET  /venues/availability?from&to&minCapacity&venueType → [{…venue, free, approved[], pending}]   (ช่วงไม่เกิน 31 วัน)
GET  /resources    POST /resources    PATCH /resources/:id (ลดจำนวนต่ำกว่ายอดที่อนุมัติไม่ได้)    GET /resources/:id/availability?from&to → {quantity, used, available}
# การจอง (สถานที่ /venue-bookings · อุปกรณ์ /resource-bookings — รูปแบบเดียวกัน)
GET  /venue-bookings?view=mine|approve&eventId&venueId&status&from&to
POST /venue-bookings {venueId, startAt, endAt, eventId?, purpose?}     (eventId → ต้องมี event:update ของกิจกรรม; ไม่ผูก → venue:view)
POST /resource-bookings {resourceId, quantity, startAt, endAt, eventId?, purpose?}
POST /…/:id/approve {note?}   POST /…/:id/reject {note}   (venue:approve ในขอบเขตผู้ดูแล, ผู้ขอพิจารณาของตนเองไม่ได้)
POST /…/:id/cancel {note?}    (ผู้ขอ / ผู้จัดกิจกรรม / ผู้อนุมัติ)

# การแจ้งเตือน
GET  /me/notifications?unread=true    GET /me/notifications/unread-count    POST /me/notifications/:id/read    POST /me/notifications/read-all
GET|PUT /me/notification-preferences {email?, line?}    POST /me/line/link-code → {code (8 หลัก, 10 นาที), botId}    DELETE /me/line
POST /public/line/webhook   (ตรวจ X-Line-Signature = base64 HMAC-SHA256(raw body, LINE_CHANNEL_SECRET))
GET  /notification-logs?status&channel&search (system_setting:view)    POST /notification-logs/:id/retry (system_setting:update)
GET  /notification-templates    PUT /notification-templates/:code/:channel {subject?, body, isActive?}   (channel = IN_APP|EMAIL|LINE)
```
error code ใหม่: `VENUE_CONFLICT` (details.clash), `RESOURCE_UNAVAILABLE` (details: quantity, used, available), `DUPLICATE_CODE`, `LINE_DISABLED`

## Endpoints (P3b — สมัครสมาชิก)
```text
POST /auth/register {email, password (≥10), displayName, phone?}  → 202 (คำตอบเหมือนกันเสมอ ไม่บอกว่าอีเมลมีบัญชีแล้วหรือไม่)
POST /auth/resend-verification {email} → 202     POST /auth/verify-email {token} → {verified, email}
GET  /auth/providers → {google, selfRegistration}
```
บัญชีที่สมัครเองเป็น `PENDING_VERIFICATION` จนกว่าจะยืนยันอีเมล — login ด้วยรหัสผ่านที่ถูกต้องได้ `403 EMAIL_NOT_VERIFIED` · อีเมลโดเมนมหาวิทยาลัย (`GOOGLE_ALLOWED_DOMAINS`) ได้ `USE_SSO` · ปิดการสมัครด้วย `SELF_REGISTRATION_ENABLED=false` และปิดอัตโนมัติใน production ถ้าไม่ได้ตั้ง `SMTP_URL`
