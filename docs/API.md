# API (REST `/api/v1`)

เอกสารเต็ม (OpenAPI): `GET /api/docs` · JSON: `/api/docs/openapi.json` (ไม่เปิดใน production)

## มาตรฐาน
- Response สำเร็จ `{ "success": true, "data": …, "meta": { "page", "perPage", "total" } }`
- Error `{ "success": false, "error": { "code", "message", "details?", "requestId" } }` — client ตัดสินใจจาก `code`
- Status: 200/201, 400 (`IDEMPOTENCY_KEY_REQUIRED`), 401 (`UNAUTHORIZED`, `INVALID_CREDENTIALS`), 403 (`FORBIDDEN`, `CSRF_INVALID`), 404, 409 (`INVALID_STATE`, `VERSION_CONFLICT`, `DUPLICATE_REGISTRATION`, `EVENT_FULL`, `REGISTRATION_CLOSED`), 422 (`VALIDATION_ERROR` + details), 429
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
