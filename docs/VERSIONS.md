# เวอร์ชันที่เลือกใช้ (ณ 5 พ.ย. 2569)

ทุกแพ็กเกจ pin เวอร์ชันแน่นอนใน `package.json` และ `pnpm-lock.yaml`

| ส่วน | เวอร์ชัน | หมายเหตุการเลือก |
|---|---|---|
| Node.js | ≥ 22.12 (image `node:22.12`) | LTS; Prisma 7 รองรับ ^22.12 |
| pnpm / Turborepo | 10.28.0 / 2.11.10 | |
| TypeScript | **5.9.3** | TS 7.0 (native) ออกแล้ว แต่ Nest CLI 11 และ ts-jest ยังไม่รองรับ |
| NestJS | **11.2.8** | Nest 12 เป็น ESM-only — Jest/Supertest (บังคับใน spec) ยังรองรับ ESM แบบทดลอง จึงใช้สาย 11 ที่ยังได้รับการดูแล (ออก 23 ต.ค. 2569) |
| Prisma | **7.10.1** + `@prisma/adapter-pg` | tag `latest` ของ npm ชี้ไปที่ 8.0.0-rc จึงใช้ 7.x stable; generator `prisma-client` (CJS), multi-file schema |
| PostgreSQL | 17 | ใช้ `NULLS NOT DISTINCT`, exclusion constraint (btree_gist) |
| Redis | 7.4.12 | BullMQ (P2) |
| Object storage | SeaweedFS 4.52 (dev) | MinIO หยุดเผยแพร่ community image บน Docker Hub/Quay; production ใช้ S3-compatible ใดก็ได้ |
| Next.js / React | 16.4.5 / 19.3.1 | App Router, Turbopack |
| Ant Design | 6.7.0 (+ icons 6.3.4, nextjs-registry 1.3.0) | ใน antd 6: `Alert.title`, `Drawer.size`, `closable.onClose` แทน prop เดิม; antd ใช้ใน RSC ไม่ได้ → หน้า server ส่งข้อมูลให้ client view |
| TanStack Query / Zustand | 5.106.0 / 5.0.16 | |
| React Hook Form / Zod / resolvers | 7.91.0 / 4.6.7 / 7.0.2 | |
| Axios | 1.21.0 | |
| ExcelJS | 4.4.0 | |
| argon2 | 0.45.2 | argon2id m=19MiB t=2 p=1 (OWASP) |
| Jest / ts-jest / Supertest | 30.5.2 / 29.4.15 / 7.3.1 | |
| Playwright | 1.64.1 | ติดตั้งแล้ว ชุดทดสอบ UI ใน P5 |
