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
