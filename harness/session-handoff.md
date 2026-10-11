# Session Handoff — วางร้าน (Wang-Raan) Backend Service

> **archive**: เก็บ 5 entry ล่าสุดเท่านั้น — รายการก่อนหน้าจะถูกย้ายไปเก็บที่
> `harness/archive/session-handoff-archive.md`

## 2026-10-10 16:57 ICT — feat-001 เสร็จ: Fastify Foundation & Tooling

### Core & Dev
- เพิ่ม Fastify bootstrap (`src/app.ts`, `src/server.ts`) แบบ ESM และ TypeScript strict
- เพิ่ม `package.json`, toolchain configurations, `.env.example`, ignore files และ Vitest lifecycle test
- `npm start` ฟังที่ `0.0.0.0:4000`; route ของโดเมนและ health check ฉบับจริงยังสงวนไว้ให้ feature ถัดไป

### QA
- ผ่าน `npm run build`, `make test`, `make lint`, `make contract` และ `npm run format`
- ทดสอบเปิดและปิด Fastify server บน port 4000 สำเร็จ

### Next Steps
1. เริ่ม **feat-002**: เชื่อมต่อ core package, Zod และ contract integration

## 2026-10-10 17:24 ICT — feat-002 เสร็จ: Core Package & Contract Integration

### Core & Dev
- package `@bosskantaponguttarawichien-boop/wang-raan-core@1.0.0` ถูก publish และติดตั้งสำเร็จ พร้อม `zod@3.25.76`
- `.npmrc` กำหนดเฉพาะ GitHub Packages registry scope; local development ใช้ credentials จาก `npm login`
- เพิ่ม `src/services/validator.ts` เป็นจุดเดียวสำหรับ parse ด้วย shared Zod schema และคำนวณ `validateLayout()`

### QA
- ผ่าน `npm run build`, `make test` (4/4), `make lint` และ `make contract`

### Next Step
1. เริ่ม **feat-003**: PostgreSQL infrastructure และ migration architecture

## 2026-10-10 17:33 ICT — feat-003 เสร็จ: PostgreSQL Infrastructure & Migrations

### Core & Dev
- เพิ่ม `pg` pool, migration runner แบบ transaction + advisory lock, migration state และ CLI migrate/rollback
- สร้าง schema หลัก 5 ตารางตาม architecture พร้อม indexes ที่จำเป็น

### QA
- PostgreSQL 16 integration: migrate, idempotent re-run และ rollback ผ่านครบ
- ผ่าน `make test` (7/7), `make lint`, `make contract` และ format check
- ลบ PostgreSQL container ชั่วคราวหลังทดสอบแล้ว

### Next Step
1. เริ่ม **feat-004**: Security, Auth & Tracing Middleware

## 2026-10-11 13:55 ICT — feat-004 เสร็จ: Security, Auth & Tracing Middleware

### Core & Dev
- `buildApp({ config?, fastify? })` ติดตั้ง pipeline กลาง: error handler → request context (X-Request-Id / X-Client-IP) → auth (onRequest)
- route ใหม่กำหนดสิทธิ์ด้วย `config: { auth: 'user' | 'anonymous' | 'none' }` (ค่าเริ่มต้น `user`); ใช้ `request.auth.userId` เท่านั้นเป็นตัวตนผู้ใช้
- route ที่รับ body ใหญ่ต้องตั้ง `bodyLimit: BODY_LIMITS.layout` / `BODY_LIMITS.contactMessage`; ค่าอื่นใช้ 1 KB อัตโนมัติ
- โยน `AppError(status, code, message, extras)` จาก service เพื่อให้ได้ error format ตามสัญญา; ZodError แปลงเป็น 400 INVALID_REQUEST อัตโนมัติ

### QA
- ผ่าน `make test` (38/38), `make lint`, `make contract`; smoke test บน build จริงผ่าน

### Notes
- `X-Request-Id` ที่ไม่มี/ไม่ใช่ UUID จะสร้างใหม่แทนการตอบ 400 (BFF ส่งเสมอ) — `X-Client-IP` ที่บังคับใน feat-008/010 ให้ route ตรวจ `request.clientIp` เอง
- `GET /health` ใน feat-005 ต้องตั้ง `config: { auth: 'none' }`

### Next Step
1. เริ่ม **feat-005**: Health Check API (`GET /health`)

## 2026-10-11 14:15 ICT — feat-005 เสร็จ: Health Check API

### Core & Dev
- `GET /health` ใน `src/modules/health/` ไม่ต้องมี token; ตอบ 200 ok / 503 degraded ตาม openapi `Health` schema
- `buildApp({ config?, database?, fastify? })` — module ถัดไปที่ต้องใช้ DB ให้รับ pool ผ่าน option `database` ในรูปแบบเดียวกัน
- `server.ts` เป็นเจ้าของ pg pool (สร้าง, ดัก idle error, ปิดตอน shutdown) — ต้องมี `DATABASE_URL`
- ตั้ง `APP_VERSION` ตอน deploy (feat-012) เพื่อให้ health รายงานเวอร์ชันจริง ไม่งั้นใช้ค่าจาก package.json

### QA
- ผ่าน `make test` (45/45), `make lint`, `make contract`; smoke test กับ PostgreSQL 16 จริงผ่าน (200 → 503 เมื่อหยุด DB)

### Notes
- gate ของ feat-005 ใน feature_list เขียน `healthy`/`connected` ไม่ตรง openapi.yaml — implement ตามสัญญา (`ok`/`degraded`, `ok`/`unavailable`)
- Sprint 1 เสร็จครบ (feat-000 ถึง feat-005)

### Next Step
1. เริ่ม **feat-006**: Layouts CRUD & Core Validation Engine (Sprint 2)
