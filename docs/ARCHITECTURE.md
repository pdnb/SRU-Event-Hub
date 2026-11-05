# สถาปัตยกรรม

```text
Browser ──HTTPS──▶ Nginx ──▶ web  (Next.js: SSR portal + SPA หลังบ้าน)
                       └──▶ api  (NestJS REST /api/v1) ──▶ PostgreSQL 17
                                                       ├─▶ Redis (BullMQ, cache, throttling)   [P2]
                                                       └─▶ S3-compatible (public / private bucket)
                         worker (BullMQ: email, PDF, หมดเวลาชำระ, export) [P2 แยก process ได้]
```

- Frontend ไม่เข้าถึงฐานข้อมูลโดยตรง ทุกอย่างผ่าน REST API (`packages/api-client`)
- Web และ API อยู่ origin เดียวกันหลัง Nginx → cookie เป็น first-party
- แยก web / api / worker / database ได้อิสระ (stateless api; session อยู่ใน DB)

## Backend (apps/api)
| โมดูล | หน้าที่ |
|---|---|
| `common` | envelope `{success,data,meta}`, error filter (ไม่ส่ง stack), pagination, `AccessService` (data scope), `AuditService`, `SequenceService` (เลขเอกสารตามปีงบประมาณ), Idempotency interceptor |
| `auth` | password (argon2id, lockout 5 ครั้ง/15 นาที), Google OIDC (เปิดเมื่อมี config), JWT access 15 นาที + refresh rotation (httpOnly cookie), CSRF double-submit |
| `users`, `organizations`, `categories` | บัญชี บทบาท หน่วยงาน (tree) lookup ที่กำหนดเองได้ |
| `events` | CRUD, state machine (`event-state.ts`), optimistic locking (`version`), เลื่อนกำหนดการ/ยกเลิกพร้อมประวัติ |
| `approvals` | workflow หลายขั้นที่กำหนดเอง (ROLE / USER / ORG_HEAD / PARENT_ORG_HEAD), ขั้นตรวจการเงินเฉพาะกิจกรรมที่มีค่าใช้จ่าย |
| `registrations` | ลงทะเบียนแบบ atomic, waitlist FIFO, ตรวจ/ยกเลิกด้วย token, export |

Global guards ตามลำดับ: Throttler → CSRF → JWT (ทุก route ต้อง login ยกเว้น `@Public`) → Permissions (`@RequirePermissions`) แล้ว service ตรวจ **data scope** ซ้ำทุกครั้ง

## สิทธิ์ (RBAC + Data Scope)
- Role = ข้อมูล (ตาราง `roles`), Permission = โค้ด `resource:action` (seed จาก `prisma/seed/rbac.ts`)
- การมอบ role (`user_roles`) ผูกหน่วยงาน + scope: `ALL` · `ORGANIZATION_TREE` · `ORGANIZATION` · `OWN`
- สิทธิ์โหลดใหม่ทุก request → เพิกถอน/ระงับมีผลทันที
- Separation of duties ที่ backend: ผู้เสนอกิจกรรมอนุมัติของตนเองไม่ได้, กำหนด/เพิกถอนสิทธิ์ของตนเองไม่ได้, SUPER/SYSTEM ADMIN มอบได้เฉพาะ Super Admin

## Frontend (apps/web)
- `app/(public)` portal (Server Component ดึงข้อมูล → client view เพราะ antd ใช้ใน RSC ไม่ได้), `app/admin` หลังบ้าน (client, TanStack Query)
- ฟอร์ม: React Hook Form + Zod (schema ร่วมจาก `@sru/validation`), `RhfField` เชื่อมกับ antd
- Zustand เฉพาะ UI state (sidebar), server state อยู่ใน TanStack Query
- วันที่: เก็บ UTC, แสดง Asia/Bangkok + พ.ศ. ที่ชั้น presentation เท่านั้น (`@sru/shared-utils/thai-date`)
