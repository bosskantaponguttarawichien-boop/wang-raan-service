# Progress Log — วางร้าน (Wang-Raan) Backend Service

> **archive**: เก็บ entry เดือนปัจจุบันเท่านั้น — รายการก่อนหน้าจะถูกย้ายไปเก็บที่
> `harness/archive/progress-YYYY-MM.md`

## [2026-10-10 16:30] feat-000: วางระบบ Harness & Agent Operating System สำหรับ wang-raan-service

- ลอก pattern ของ Harness จากโปรเจกต์หลัก `wang-raan` ปรับให้สอดคล้องกับสถาปัตยกรรม Backend Service (`wang-raan-service`)
- สร้าง `harness/init.sh` ตรวจสอบ Environment (Node.js 20+, npm, python3, Docker), Architectural Boundaries (Pure Node.js, ไม่มี UI/React/DOM, มี `contracts/openapi.yaml`) และรัน validation
- สร้าง `scripts/validate_harness.py` และ `scripts/harness_state.py` สำหรับตรวจจับ Task schema, cyclic dependencies, และ merge state
- สร้าง `harness/feature_list.json` กำหนด Roadmap งาน Backend ทั้งหมด 13 tasks (feat-000 ถึง feat-012) แบ่งออกเป็น 3 Sprints:
  - **Sprint 1 (Foundation & Core Infra):** feat-000 ถึง feat-005 (Tooling, Core Package, DB Migrations, Auth Middleware, Health Check)
  - **Sprint 2 (Domain APIs & Business Logic):** feat-006 ถึง feat-010 (Layouts CRUD, Share Links, Public Viewer, User & PDPA, Contact Messages & Rate Limiting)
  - **Sprint 3 (Contract Testing & Production Deployment):** feat-011 ถึง feat-012 (Automated Contract Tests, Docker, Railway, Cloudflare R2 Backup)
- Sync สัญญา API `contracts/openapi.yaml` (v1.1.0) จากโปรเจกต์หลักเพื่อเป็น Single Source of Truth
- ปรับปรุง `PRD.md`, `README.md`, และ `SKILL.md` ให้สอดคล้องกับสถาปัตยกรรม Backend Service (`wang-raan-service`), ข้อตกลง OpenAPI v1.1.0, กฎความปลอดภัย Zero-Trust JWT และ Harness Task Roadmap อย่างสมบูรณ์
- สร้าง `AGENTS.md`, `SKILL.md`, และ `Makefile` เพื่อกำหนดระเบียบปฏิบัติและคำสั่งอัตโนมัติของ Agent
- QA: `./harness/init.sh` ผ่าน 100%, `python3 scripts/validate_harness.py` ตรวจสอบผ่าน 13 tasks (Done: 1, Not Started: 12), `make lint` และ `make contract` ผ่านฉลุย

## [2026-10-10 16:57] feat-001: Project Foundation, Fastify Bootstrap & Tooling

- สร้าง Node.js/TypeScript แบบ Native ESM และ strict compiler settings พร้อม `src/app.ts` และ `src/server.ts`
- ติดตั้ง Fastify, Vitest, ESLint, Prettier, TypeScript, tsx และ Node type definitions; กำหนด scripts สำหรับ dev, build, start, test, lint, typecheck และ format
- เพิ่ม `.env.example`, `.gitignore`, Prettier และ ESLint configuration สำหรับ backend-only source
- เพิ่ม Vitest bootstrap test ตรวจว่า Fastify เปิดและปิด HTTP listener ได้ และจำกัด test discovery ให้รันเฉพาะชุดทดสอบของ Backend repository นี้
- QA: `npm run build`, `make test`, `make lint`, `make contract` และ `npm run format` ผ่านทั้งหมด; ยืนยัน `npm start` เปิด Fastify ที่ port 4000 และหยุดได้แล้ว

## [2026-10-10 17:00] feat-002: Core Package & Contract Integration (in progress)

- ตั้งค่า `.npmrc` ให้ชี้ scope `@bosskantaponguttarawichien-boop` ไป GitHub Packages ถูกต้องแล้ว
- ติดตั้ง `zod@3.25.76` สำเร็จ
- ยังติดตั้ง `@bosskantaponguttarawichien-boop/wang-raan-core` ไม่ได้: GitHub Packages ตอบ 404 ว่า package ไม่มีอยู่ภายใต้ owner นี้หรือ credentials ไม่มีสิทธิ์เข้าถึง
- ต้องมี `GITHUB_TOKEN` ที่มี `read:packages` สำหรับ owner/package นี้ หรือยืนยันชื่อ package/repository ที่ถูกต้อง ก่อนจะสร้าง adapter และทดสอบ `validateLayout()` ได้

## [2026-10-10 17:24] feat-002: Core Package & Contract Integration

- เผยแพร่ `@bosskantaponguttarawichien-boop/wang-raan-core@1.0.0` จาก repo หลักสำเร็จ แล้วติดตั้งใน backend ได้
- แก้ `.npmrc` ให้กำหนดเฉพาะ registry scope เพื่อใช้ credentials ที่ได้จาก `npm login` โดยไม่ทับ token ใน user-level npm config
- เพิ่ม `src/services/validator.ts` ซึ่ง parse request ด้วย `SaveLayoutRequestSchema` และคำนวณ `validateLayout()` จาก core package โดยตรง
- เพิ่ม test สำหรับ blocked layout, schema ที่ผิด และ object id ซ้ำ ซึ่ง OpenAPI JSON Schema ตรวจไม่ได้
- QA: `npm run format`, `npm run build`, `npm run lint`, `make test`, `make lint`, และ `make contract` ผ่าน (Vitest 4/4)

## [2026-10-10 17:33] feat-003: Database Infrastructure & Migrations Architecture

- เพิ่ม `pg` connection-pool factory และ migration runner ที่ใช้ transaction พร้อม PostgreSQL advisory lock
- เพิ่ม initial schema สำหรับ `users`, `layouts`, `share_links`, `contact_messages`, `rate_limits`, FK และ indexes ตาม architecture.md; เปิด `pgcrypto` เพื่อรองรับ contact-message UUID
- เพิ่ม CLI `npm run db:migrate` และ `npm run db:rollback`; migration state เก็บใน `schema_migrations`
- QA integration บน PostgreSQL 16 container: migrate สร้าง tables/indexes ครบ, run ซ้ำรายงาน none, rollback ลบ domain tables เหลือ 0; ปิดและลบ container ทดสอบแล้ว
- QA: `make test` 7/7, `make lint`, `make contract` และ `npm run format` ผ่าน
## [2026-10-11 13:55] feat-004: Security, Auth & Tracing Middleware

- เพิ่ม `jose` และ `src/config/env.ts` ตรวจ env ด้วย Zod (`INTERNAL_TOKEN_SECRET` ≥ 32 ตัวอักษร, `LOG_LEVEL`) — ค่าผิดให้ server ล้มตั้งแต่เริ่ม
- `src/middleware/auth.ts`: ตรวจ Bearer JWT HS256, `iss`/`aud`, `maxTokenAge` 300s + clock tolerance 5s, บังคับ `exp - iat ≤ 300`, `sub` 1–128 ตัว; นโยบายต่อ route ผ่าน `config.auth` (`user` ค่าเริ่มต้น / `anonymous` สำหรับ `x-allow-anonymous` / `none` สำหรับ `/health`); รันใน `onRequest` ก่อน parse body และครอบ 404 handler ด้วย
- `src/middleware/request-context.ts`: ใช้ `X-Request-Id` (UUID) เป็น request id → log label `requestId` และส่งกลับใน response header; ค่าไม่ใช่ UUID สร้างใหม่; อ่าน `X-Client-IP` เป็น `request.clientIp`
- `src/middleware/payload-limiter.ts`: `BODY_LIMITS` (default 1 KB ระดับ app, ผัง 512 KB, ฟอร์มติดต่อ 8 KB ให้ route ระบุเอง)
- `src/middleware/error-handler.ts` + `errors.ts`: `AppError` และ error format `{ error: { code, message, ... } }` ตามสัญญา; map 413/415/400 INVALID_JSON/INVALID_REQUEST (Zod/Fastify validation พร้อม `details`)/404/500 INTERNAL_ERROR โดยไม่เปิดเผยข้อความภายใน
- Logger redact `authorization`/`cookie`; `buildApp()` รับ `{ config, fastify }`
- QA: `make test` 38/38 (เพิ่ม middleware 30 เคส, config 2 เคส), `make lint`, `make contract` ผ่าน; smoke test บน `dist/` ยืนยัน 401 + `x-request-id` สะท้อนกลับ, log มี `requestId` และไม่มี token
## [2026-10-11 14:15] feat-005: Health Check API (GET /health)

- เพิ่ม `src/modules/health/health.service.ts` (probe `SELECT 1` พร้อม timeout 2 วินาที เพราะ pg ไม่มี connect timeout ค่าเริ่มต้น) และ `health.routes.ts` (`config: { auth: 'none' }`, `Cache-Control: no-store`)
- Response ตาม `components.schemas.Health`: 200 `{ status: "ok", version, database: "ok" }` / 503 `{ status: "degraded", version, database: "unavailable" }` — gate ใน feature_list เขียน `healthy`/`connected` ซึ่งขัด openapi.yaml จึงยึดสัญญา
- `AppConfig.version` มาจาก `APP_VERSION` (ตั้งตอน deploy) หรือ `version` ใน package.json
- `buildApp({ database })` รับ pool จากผู้เรียก; `server.ts` สร้าง pool, ดัก `error` ของ idle client (กัน process ล่มตอน DB รีสตาร์ต) และปิด pool ใน `onClose`; ปิด request log ของ `/health`
- QA: `make test` 45/45, `make lint`, `make contract` ผ่าน; smoke test กับ PostgreSQL 16 container: DB ขึ้น → 200, หยุด DB → 503 และ server ยังทำงาน, log ไม่มี credentials; ลบ container แล้ว
