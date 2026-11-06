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
| Rate limiting | Global 300/นาที/IP, login 10/นาที, ลงทะเบียน 20/นาที, ตรวจสถานะ 10/นาที, ยกเลิกด้วย token 5/นาที, แนบสลิป 10/นาที + Nginx limit_req — ตัวนับเก็บใน Redis (Lua atomic) ใช้ร่วมกันทุก replica; Redis ล่ม = fail-open (timeout 500ms) เหลือ Nginx เป็นด่านสุดท้าย |
| Idempotency | `Idempotency-Key` บังคับกับ endpoint ที่สร้างรายการลงทะเบียน (และเงินใน P2) ผูกกับผู้ใช้/IP + hash ของ body |
| Errors | ไม่ส่ง stack trace; ส่ง `requestId` ให้ตามรอยใน log |
| Logging | pino JSON + request id, redact `authorization`, `cookie`, `set-cookie`, `password`, `token` |
| Audit | `audit_logs` append-only (trigger) — ผู้ทำ, IP, user agent, ก่อน/หลัง, เหตุผล |
| Enumeration | ตรวจสถานะด้วยเลขอ้างอิง+token (token เก็บ hash) ตอบข้อความเดียวกันทั้งไม่พบ/token ผิด |
| Redirect | `next` หลัง login รับเฉพาะ path ภายใน (`/…` ไม่ใช่ `//…`) |
| Secrets | ไม่มีค่า secret ใน repo, env ตรวจรูปแบบตอนเริ่มระบบ (fail fast), `THROTTLE_DISABLED` ห้ามใน production |
| PDPA | บันทึกเวลาและเวอร์ชันความยินยอมทุกการลงทะเบียน, งบประมาณไม่แสดงบน portal |

## ระยะถัดไป
- ✅ P2: field encryption AES-256-GCM (`FIELD_ENCRYPTION_KEY`, IV สุ่มทุกค่า, ตรวจ auth tag) สำหรับเลขบัญชีคืนเงิน — แสดงแบบปิดบัง, การดูเลขเต็มต้องมี `refund:refund` และถูกบันทึก audit, ไม่ log เลขบัญชี (pino redact `req.body.accountNo`)
- ✅ P2: สลิปเก็บใน private bucket ส่งผ่าน API ที่ตรวจสิทธิ์ (ไม่เปิด storage สู่ภายนอก), ตรวจชนิดไฟล์จาก magic number, SHA-256 กันสลิปซ้ำ
- ✅ P2: Separation of duties ด้านการเงิน (ตรวจสลิป, ยกเลิกรับเงิน, ยืนยันยอดกะ, รับชุดนำส่ง, อนุมัติ/จ่ายคืนเงิน) บังคับที่ API
- ✅ P2: ESLint (`pnpm lint`) — typescript-eslint, react-hooks, next
- P3: token ลิงก์เชิญ (hash, ใช้ครั้งเดียว), ตรวจไฟล์ Excel นำเข้า
- ✅ P4: QR เช็กอิน = HMAC-SHA256 (คีย์ HKDF จาก `FIELD_ENCRYPTION_KEY`) 128 บิต — DB เก็บเฉพาะ SHA-256 (อ่าน DB แล้วปลอม QR ไม่ได้), ออกใหม่ = QR เดิมใช้ไม่ได้, รายชื่อออฟไลน์มีเฉพาะ hash · ดู QR แบบไม่ login ต้องมีเลขอ้างอิง+token (ตอบเหมือนกันทั้งไม่พบ/ผิด, จำกัดอัตรา)
- ✅ P4: Socket.IO ยืนยันตัวตนด้วย access token เดียวกับ REST, ตรวจ `checkin:view` ทุกการ subscribe, ข้อความไม่มีข้อมูลส่วนบุคคล, จำกัดขนาดข้อความ 16 KB, CORS ตาม `CORS_ORIGINS`
- ✅ P4: `checkin_records`, `badge_prints` append-only (trigger); พิมพ์ป้ายซ้ำต้องมีสิทธิ์+เหตุผล; ภาพพื้นหลังป้ายตรวจ magic number เก็บ private bucket
- ✅ P5a: เกียรติบัตรตรวจสอบด้วยรหัสสุ่ม 60 บิต (เดาไม่ได้ ไม่ใช่เลขเรียง) — หน้าสาธารณะแสดงเฉพาะชื่อผู้รับ/กิจกรรม/สถานะ ไม่มีอีเมลหรือเลขอ้างอิง, จำกัดอัตรา, บันทึกการตรวจโดยเก็บ IP เป็น HMAC · เนื้อหาเกียรติบัตรแก้/ลบไม่ได้ระดับฐานข้อมูล (trigger) · ดาวน์โหลดแบบ guest ใช้ POST + เลขอ้างอิง/token (ไม่อยู่ใน URL)
- ✅ P5a: แบบประเมินไม่ระบุตัวตนไม่เก็บ registration_id และ audit log ไม่บันทึกผู้ส่ง/IP — เก็บเพียง HMAC(form, registration) ด้วยคีย์ HKDF แยกวัตถุประสงค์ (ผู้ที่มีทั้ง DB และคีย์ยังจับคู่ได้ จึงเป็น pseudonymous — ดู CERT-4)
- ✅ P5b: webhook LINE ตรวจลายเซ็น HMAC ด้วย raw body (timing-safe) และไม่ใช้ session/CSRF · รหัสเชื่อมบัญชีเก็บเฉพาะ SHA-256 ใช้ครั้งเดียว 10 นาที · หน้าประวัติการส่งแสดง LINE user id แบบปิดบัง
- ✅ P5b: การแจ้งเตือนสร้างจาก audit row ที่ commit แล้วเท่านั้น (ไม่แจ้งงานที่ rollback) และผ่าน dedupe key เสมอ · การส่งล้มเหลวไม่ทำให้ธุรกรรมล้มเหลว
- ✅ P5b: การจองสถานที่/อุปกรณ์ — ผู้ขออนุมัติคำขอของตนเองไม่ได้, สิทธิ์อนุมัติตามหน่วยงานผู้ดูแล (ส่วนกลางต้องขอบเขต ALL), กันจองซ้อน/เกินจำนวนที่ระดับฐานข้อมูล
