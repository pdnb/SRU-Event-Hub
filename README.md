# SRU Event Hub

ระบบบริหารจัดการกิจกรรม มหาวิทยาลัยราชภัฏสุราษฎร์ธานี — แพลตฟอร์มกลางสำหรับเสนอ อนุมัติ ประชาสัมพันธ์ ลงทะเบียน ชำระเงิน ตรวจสอบการเข้าร่วม ประเมินผล และออกเกียรติบัตร

> สถานะปัจจุบัน: **ระยะที่ 1 (Foundation)** — ดูขอบเขตแต่ละระยะใน [docs/ROADMAP.md](docs/ROADMAP.md)

## โครงสร้าง

```text
apps/api        NestJS 11 + Prisma 7 (PostgreSQL)  → REST /api/v1, Swagger /api/docs
apps/web        Next.js 16 App Router + Ant Design 6 → portal สาธารณะ + ระบบหลังบ้าน /admin
packages/       shared-types · shared-utils (เงิน/บาทถ้วน/PromptPay/ปีงบประมาณ) · validation (Zod) · api-client · shared-config
infrastructure/ Dockerfile, Nginx, สคริปต์
docs/           เอกสารออกแบบ (ARCHITECTURE, DATABASE, WORKFLOW, PAYMENT, API, SECURITY, DEPLOYMENT, OPEN_QUESTIONS, VERSIONS)
```

## เริ่มต้นใช้งาน (พัฒนาในเครื่อง)

ต้องมี Node.js ≥ 22.12, pnpm 10, Docker

```bash
cp .env.example .env              # แล้วกำหนดค่า secret (ดูคำอธิบายในไฟล์)
cp .env apps/api/.env
cp .env apps/web/.env.local
pnpm install
pnpm infra:up                     # PostgreSQL 17, Redis 7.4, S3 (SeaweedFS)
pnpm --filter "./packages/*" build
pnpm db:migrate                   # apply migrations
pnpm db:seed                      # ข้อมูลอ้างอิง + บัญชีทดลอง (SEED_DEMO=false เพื่อไม่สร้างบัญชีทดลอง)
pnpm dev                          # api :4000, web :3000
```

- หน้าเว็บ: http://localhost:3000 · หลังบ้าน: http://localhost:3000/admin
- Swagger: http://localhost:4000/api/docs (ปิดอัตโนมัติใน production)
- บัญชีทดลอง: `superadmin`, `sci.manager`, `sci.dean`, `executive`, `finance`, `student` ฯลฯ (รายการเต็มพิมพ์ออกมาตอน seed) รหัสผ่านมาจาก `SEED_DEMO_PASSWORD` หรือสุ่มและแสดงครั้งเดียว
- หาก port 6379 ถูกใช้อยู่ ให้ตั้ง `REDIS_HOST_PORT` และ `REDIS_URL` ใน `.env`

## การทดสอบ

```bash
pnpm --filter @sru/shared-utils test   # unit: เงิน, บาทถ้วน, PromptPay (เทียบกับไลบรารีอ้างอิง), ปีงบประมาณ
pnpm --filter @sru/api test            # unit: state machine ของกิจกรรม
pnpm --filter @sru/api test:e2e        # e2e ผ่าน HTTP + PostgreSQL จริง (ต้อง infra:up + seed)
```

E2E ครอบคลุม: login/CSRF/refresh-token rotation + reuse detection, สิทธิ์ฝั่ง backend, workflow อนุมัติหลายขั้น + separation of duties, Idempotency-Key, กันสมัครซ้ำ, **การลงทะเบียนพร้อมกันไม่เกินจำนวนที่นั่ง**, รายชื่อสำรองและการเลื่อนลำดับอัตโนมัติ, export Excel

## Production

ดู [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — `docker compose --profile app up -d --build` (Nginx → web + api)
