# API (REST `/api/v1`)

เอกสารเต็ม (OpenAPI): `GET /api/docs` · JSON: `/api/docs/openapi.json` (ไม่เปิดใน production)

## มาตรฐาน
- Response สำเร็จ `{ "success": true, "data": …, "meta": { "page", "perPage", "total" } }`
- Error `{ "success": false, "error": { "code", "message", "details?", "requestId" } }` — client ตัดสินใจจาก `code`
- Status: 200/201, 400 (`IDEMPOTENCY_KEY_REQUIRED`), 401 (`UNAUTHORIZED`, `INVALID_CREDENTIALS`), 403 (`FORBIDDEN`, `CSRF_INVALID`), 404, 409 (`INVALID_STATE`, `VERSION_CONFLICT`, `DUPLICATE_REGISTRATION`, `EVENT_FULL`, `REGISTRATION_CLOSED`, `FEE_NOT_AVAILABLE`, `PAYMENT_EXPIRED`, `DUPLICATE_SLIP`, `PAYMENT_ALREADY_BATCHED`, `RECEIPT_EXISTS`, `RECEIPT_NO_TAKEN`), 413 (`FILE_TOO_LARGE`), 415 (`FILE_TYPE_NOT_ALLOWED`), 422 (`VALIDATION_ERROR` + details), 429
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
