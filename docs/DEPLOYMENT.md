# การติดตั้งใช้งาน (Deployment)

## Docker Compose (เครื่องเดียว)
```bash
cp .env.example .env      # กำหนด secret ทั้งหมด, NODE_ENV=production, COOKIE_SECURE=true,
                          # CORS_ORIGINS/WEB_PUBLIC_URL = โดเมนจริง, SEED_DEMO=false
docker compose --profile app build
docker compose up -d postgres redis storage storage-init
docker compose --profile app run --rm migrate          # prisma migrate deploy
docker compose --profile app up -d api web nginx
# ครั้งแรก: ข้อมูลอ้างอิง (บทบาท สิทธิ์ หน่วยงาน ประเภท) — รันจาก image build หรือเครื่องที่เข้าถึง DB ได้
#   SEED_DEMO=false pnpm db:seed
```

- Nginx ฟัง :80 — **production ต้องมี TLS** (ใส่ใบรับรองที่ Nginx หรือ load balancer ด้านหน้า) แล้วตั้ง `TRUST_PROXY=1`
- `NEXT_PUBLIC_API_URL=/api/v1` (origin เดียวกัน) ส่วน server-side rendering ใช้ `API_INTERNAL_URL=http://api:4000/api/v1`
- Health: `GET /api/v1/health/ready` (ตรวจ DB)
- Image รันด้วย user ที่ไม่ใช่ root

## Coolify
ใช้ไฟล์ [`docker-compose.coolify.yml`](../docker-compose.coolify.yml) — ไม่มี host port และไม่มี bind mount (config ถูก bake ลง image), Traefik ของ Coolify ทำ TLS แล้วส่งต่อให้ service `nginx`

1. **New Resource → Application → (Public/Private) Git repository** เลือก repo และ branch `main`
2. **Build Pack: Docker Compose**, Base Directory `/`, Docker Compose Location `/docker-compose.coolify.yml`
3. ที่ service **nginx** ตั้ง Domain เป็น `https://<domain>` (service อื่นเว้นว่าง — ไม่เปิดสู่ภายนอก)
4. **Environment Variables** (Coolify แสดงรายการจาก compose ให้อัตโนมัติ; ตัวที่ต้องกรอก = บังคับ):

   | ตัวแปร | ค่า |
   |---|---|
   | `APP_URL` | `https://<domain>` ตรงกับ Domain ข้อ 3 **ไม่มี `/` ท้าย** (ใช้เป็น WEB_PUBLIC_URL, CORS, Google callback) |
   | `POSTGRES_PASSWORD`, `S3_SECRET_KEY` | `openssl rand -hex 24` (hex เพื่อไม่ให้ URL ของ DB เสีย) |
   | `JWT_ACCESS_SECRET` | `openssl rand -base64 48` |
   | `FIELD_ENCRYPTION_KEY` | `openssl rand -base64 32` — **สำรองไว้นอก Coolify ด้วย** หายแล้วถอดรหัสข้อมูลเดิมไม่ได้ |
   | `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` | super admin คนแรก (รหัส ≥ 12 ตัว) — สร้างครั้งเดียวถ้ายังไม่มีอีเมลนี้; deploy สำเร็จแล้ว **ลบ PASSWORD ออก** |
   | ไม่บังคับ | `SMTP_URL`, `MAIL_FROM`, `GOOGLE_*`, `LINE_*`, `SELF_REGISTRATION_ENABLED`, `SEED_ON_DEPLOY` |

5. **Deploy** — ลำดับ: postgres/redis/storage → `storage-init` (สร้าง bucket) + `migrate` (`prisma migrate deploy` แล้ว seed ข้อมูลอ้างอิง ถ้า `SEED_ON_DEPLOY=true` ค่าเริ่มต้น) → api (รอ migrate สำเร็จ) → web → nginx
   - `storage-init` และ `migrate` เป็น one-shot (ตั้ง `exclude_from_hc`) สถานะ exited ถือว่าปกติ
   - seed ซ้ำได้ แต่จะเขียนทับชื่อหน่วยงาน/บทบาทจากโค้ด — ถ้าผู้ดูแลแก้ข้อมูลอ้างอิงในระบบแล้ว ให้ตั้ง `SEED_ON_DEPLOY=false`
6. ตรวจ: `https://<domain>/api/v1/health/ready` ต้องได้ 200 แล้ว login ด้วย bootstrap admin
7. Google OAuth callback: `https://<domain>/api/v1/auth/google/callback`; LINE webhook: `https://<domain>/api/v1/public/line/webhook`

หมายเหตุ
- IP ผู้ใช้: nginx (`infrastructure/nginx/coolify.conf`) อ่าน IP จริงจาก `X-Forwarded-For` ของ Traefik แล้วส่งต่อเป็น hop เดียว → `TRUST_PROXY=1` (rate limit นับต่อผู้ใช้ ไม่ใช่ต่อ Traefik)
- ข้อมูลถาวรอยู่ใน named volume `pgdata`, `redisdata`, `storagedata` (Coolify เติม prefix ให้) — ห้ามลบ resource แบบ "delete volumes"
- สำรอง DB: Coolify backup อัตโนมัติใช้ได้กับ database resource แยกเท่านั้น สำหรับ postgres ใน compose ให้ตั้ง **Scheduled Task** บน service `postgres` เช่น `pg_dump -U sru -Fc sru_event_hub > /var/lib/postgresql/data/backup-$(date +%F).dump` แล้วคัดลอกออกนอกเครื่อง (ดูหัวข้อสำรองข้อมูล)
- Build ใช้ RAM สูง (Next.js + NestJS) — เครื่องควรมี ≥ 4 GB หรือเพิ่ม swap

## ตัวแปรสำคัญ
| ตัวแปร | หมายเหตุ |
|---|---|
| `JWT_ACCESS_SECRET` | ≥ 32 ตัวอักษร สุ่ม |
| `FIELD_ENCRYPTION_KEY` | 32 ไบต์ base64 (P2) — เก็บใน secret manager, ห้ามหาย (ถอดรหัสข้อมูลเดิมไม่ได้) |
| `GOOGLE_CLIENT_ID/SECRET` | เว้นว่าง = ปิด Google login; callback `https://<domain>/api/v1/auth/google/callback` |
| `SMTP_URL`, `MAIL_FROM` | relay ของมหาวิทยาลัย — ไม่ตั้ง = อีเมลแจ้งเตือนถูกบันทึกใน log เท่านั้น (สถานะ "ส่งแล้ว" พร้อมหมายเหตุ) |
| `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `LINE_BOT_ID` | LINE Messaging API — ตั้ง webhook ใน LINE Developers เป็น `https://<domain>/api/v1/public/line/webhook` |
| `QUEUE_ENABLED` | ต้องเป็น `true` ใน production (หมดเวลาชำระ, การแจ้งเตือน) — worker ทำงานใน api ทุก replica ได้อย่างปลอดภัย |
| `S3_*` | S3-compatible ใดก็ได้; bucket public (รูปกิจกรรม) และ private (สลิป ป้ายชื่อ เกียรติบัตร) |

## สำรองข้อมูล
- PostgreSQL: `pg_dump -Fc` รายวัน + WAL archiving (PITR) เก็บนอกเครื่อง, ทดสอบ restore รายเดือน
- Object storage: versioning/replication ของ bucket
- ระยะเวลาเก็บข้อมูลการเงินตามระเบียบกองคลัง (OPEN_QUESTIONS FIN-11)
