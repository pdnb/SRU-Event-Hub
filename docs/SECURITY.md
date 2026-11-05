# ความปลอดภัย (OWASP Top 10)

| หัวข้อ | การดำเนินการ (P1) |
|---|---|
| Authentication | argon2id (m=19MiB,t=2,p=1, rehash อัตโนมัติ), lockout 5 ครั้ง/15 นาที, เวลาตอบเท่ากันเมื่อไม่มีผู้ใช้, Google OIDC (`state`, จำกัดโดเมน, email_verified) |
| Session | Access JWT HS256 15 นาที (iss/aud) + Refresh token สุ่ม 48 ไบต์ เก็บ SHA-256, หมุนทุกครั้ง, ใช้ซ้ำ → เพิกถอนทั้ง family, ระงับบัญชี → เพิกถอนทุก session |
| Cookie | `httpOnly`, `SameSite=Lax`, `Secure` (บังคับใน production), refresh cookie ส่งเฉพาะ `/api/v1/auth` |
| CSRF | Double-submit token (`sru_csrf` cookie ↔ `X-CSRF-Token`), ข้ามได้เฉพาะ Bearer token |
| Access control | Global guard ทุก route, permission ระดับ action, data scope ตรวจใน service, SoD; การซ่อนปุ่มฝั่ง UI ไม่ใช่กลไกควบคุม |
| Input | `ValidationPipe` whitelist + forbidNonWhitelisted, Zod ฝั่ง web, ตรวจคำตอบฟอร์มแบบไดนามิกตามชนิดฟิลด์ฝั่ง server |
| Injection | Prisma (parameterized) + `$queryRaw` แบบ tagged template เท่านั้น; Excel/CSV export ป้องกัน formula injection |
| XSS / headers | React escape อัตโนมัติ, Helmet (CSP, HSTS…), Next security headers, ไม่ใช้ `dangerouslySetInnerHTML` |
| Rate limiting | Global 300/นาที/IP, login 10/นาที, ลงทะเบียน 20/นาที, ตรวจสถานะ 10/นาที, ยกเลิกด้วย token 5/นาที + Nginx limit_req |
| Idempotency | `Idempotency-Key` บังคับกับ endpoint ที่สร้างรายการลงทะเบียน (และเงินใน P2) ผูกกับผู้ใช้/IP + hash ของ body |
| Errors | ไม่ส่ง stack trace; ส่ง `requestId` ให้ตามรอยใน log |
| Logging | pino JSON + request id, redact `authorization`, `cookie`, `set-cookie`, `password`, `token` |
| Audit | `audit_logs` append-only (trigger) — ผู้ทำ, IP, user agent, ก่อน/หลัง, เหตุผล |
| Enumeration | ตรวจสถานะด้วยเลขอ้างอิง+token (token เก็บ hash) ตอบข้อความเดียวกันทั้งไม่พบ/token ผิด |
| Redirect | `next` หลัง login รับเฉพาะ path ภายใน (`/…` ไม่ใช่ `//…`) |
| Secrets | ไม่มีค่า secret ใน repo, env ตรวจรูปแบบตอนเริ่มระบบ (fail fast), `THROTTLE_DISABLED` ห้ามใน production |
| PDPA | บันทึกเวลาและเวอร์ชันความยินยอมทุกการลงทะเบียน, งบประมาณไม่แสดงบน portal |

## ระยะถัดไป
- P2: field encryption AES-256-GCM (`FIELD_ENCRYPTION_KEY`) สำหรับเลขบัญชีคืนเงิน/เลขผู้เสียภาษี, private bucket + presigned URL อายุสั้น, ตรวจ MIME จาก magic number, Redis throttler storage
- P3: token ลิงก์เชิญ (hash, ใช้ครั้งเดียว), ตรวจไฟล์ Excel นำเข้า
