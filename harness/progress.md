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

## [2026-10-11 14:50] feat-006: Layouts CRUD & Core Validation Engine

- เพิ่ม `src/modules/layouts/` (schemas, repository, service, routes) ครบ 5 endpoint ตามสัญญา รวม `PUT /v1/layouts/{layoutId}` ซึ่ง description ของ feature ไม่ได้ระบุแต่สัญญากำหนด
- ด่านตรวจสองชั้นก่อนแตะ DB: `SaveLayoutRequestSchema` (strict — `validation` จาก client ถูกปฏิเสธ) → `validateLayout()`; blocked → 422 พร้อม `validation` และ `issues` ระดับ blocked
- โควตา 200 ผัง/ผู้ใช้ตรวจภายใต้ `pg_advisory_xact_lock` ต่อผู้ใช้ (ทดสอบยิงพร้อมกัน 5 คำขอแล้วไม่เกิน 200)
- `ensureUser()` สร้างแถว users ขั้นต่ำ (provider จาก prefix ของ sub) เพราะ FK — sub ที่ provider ไม่รู้จักตอบ 401
- DELETE ลบผังและ revoke share links ใน transaction เดียว (`src/modules/shares/shares.repository.ts`)
- Middleware: ปิด parser `text/plain` (ต้อง 415), `maxParamLength` 2048 และ `frameworkErrors` ให้ URL เสีย/param ยาวเกินตอบ 404 รูปแบบสัญญา; id เกิน 128 ตัวตอบ 404
- Integration test infra: `scripts/with-test-db.sh` (Postgres 16 ชั่วคราวผ่าน Docker หรือ `TEST_DATABASE_URL`), `vitest.integration.config.ts`, `npm run test:integration`; `make test` รันทั้ง unit และ integration
- QA: unit 46/46, integration 16/16, `make lint`, `make contract` ผ่าน

## [2026-10-11 15:05] feat-007: Share Links Management & Snapshots Engine

- `src/services/share-generator.ts`: `crypto.getRandomValues` 32 ไบต์ → base64url 43 ตัว (ทดสอบ 1000 คีย์ไม่ซ้ำและตรง pattern)
- `src/modules/shares/`: list/create (`/v1/layouts/{layoutId}/shares`), PATCH/DELETE (`/v1/shares/{shareKey}`)
- สร้างลิงก์ใน transaction ที่ `SELECT ... FOR UPDATE` แถวผัง → ตรวจ blocked (422), นับลิงก์ active (revoked/expired ไม่นับ) ≤ 20 (409), เก็บ snapshot layout+validation
- `expiresAt` ต้องอยู่ในอนาคตและ ≤ 365 วัน (400 INVALID_REQUEST + details); POST ไม่มี body = ไม่หมดอายุ
- status คำนวณตอนตอบ (revoked ก่อน expired); PATCH ลิงก์ revoked/expired → 410 SHARE_REVOKED/SHARE_EXPIRED; DELETE ตั้ง `revoked_at` ครั้งแรกเท่านั้น (idempotent)
- ลิงก์/ผังของผู้อื่น และ shareKey ผิดรูปแบบ → 404
- QA: unit 49/49, integration 27/27, `make lint`, `make contract` ผ่าน

## [2026-10-11 15:15] feat-008: Public Share Viewer API

- `GET /v1/public/shares/{shareKey}` ใน `shares.routes.ts` ตั้ง `config: { auth: 'anonymous' }` — ยังต้องมี internal token ที่ถูกต้อง
- repository SELECT เฉพาะ `layout, validation, created_at, expires_at, revoked_at` (ไม่แตะ `owner_id`) และ service ประกอบ response ทีละฟิลด์ตาม `PublicShare`
- 410 SHARE_REVOKED / SHARE_EXPIRED (revoked ก่อน; ใช้ helper เดียวกับ PATCH), 404 คีย์ไม่มี/ผิดรูป/เจ้าของถูกลบบัญชี
- ไม่บังคับ `X-Client-IP` และยังไม่จำกัดอัตราเรียกบน endpoint นี้ — สัญญาไม่ได้กำหนดตัวเลขหรือ 400 ไว้
- QA: integration 34/34 (เพิ่ม 7), unit 49/49, `make lint`, `make contract` ผ่าน

## [2026-10-11 15:35] feat-009: User Profile & PDPA Operations

- `src/modules/users/`: `GET/PUT/DELETE /v1/me`, `GET /v1/me/export`, `POST /v1/me/merge-guest`
- PUT upsert: ฟิลด์ที่ไม่ส่ง = คงค่าเดิม, ส่ง `null` = ล้าง; `provider` ต้องตรงกับ prefix ของ `sub` (400 ถ้าไม่ตรง); ตรวจ email/uri/ความยาวตามสัญญา
- DELETE (PDPA): ลบ users → cascade layouts/share_links/contact_messages และลบ `rate_limits` key `contact:user:<sub>` ใน transaction เดียว; เรียกซ้ำได้ 204
- Export: อ่านทุกตารางใน transaction `REPEATABLE READ READ ONLY`; ผู้ใช้ที่ไม่มีข้อมูลได้โปรไฟล์ว่างโดยไม่สร้างแถวใหม่
- Merge Guest: ล็อกสองผู้ใช้ตามลำดับ id (กัน deadlock), ย้ายผัง (id ชน → `<id>-guest-copy`, `-guest-copy-2`, … ไม่เกิน 128 ตัว และคำนวณ `validateLayout` ใหม่เพราะ `layoutRevision` ผูกกับ id), ย้ายลิงก์แชร์ (แก้ `layout_id` ตามชื่อใหม่) และข้อความติดต่อ แล้วลบบัญชี Guest; เรียกซ้ำได้ผล 0
- การตัดสินใจ: merge ไม่ตรวจโควตา 200 ผัง เพราะสัญญาไม่มี error code ให้ endpoint นี้
- QA: integration 44/44 (รวมเทส rollback โดยใช้ trigger ทำให้ล้มกลางทาง), unit 51/51, `make lint`, `make contract` ผ่าน

## [2026-10-11 16:00] feat-010: Contact Messages & Database Rate Limiter

- `src/modules/contact/`: `POST /v1/contact-messages` (`auth: 'anonymous'`, bodyLimit 8 KB) → 202 `{ id, receivedAt }`; ผู้ใช้ที่ล็อกอินผูก `user_id`
- schema = `ContactSchema` ของ core ตัด `website` (honeypot) ออก — strict + trim; ไม่มี/ผิด `X-Client-IP` → 400 INVALID_REQUEST
- `src/services/rate-limiter.ts`: fixed window 10 นาทีตาม epoch, 3 มิติ (`contact:ip:<ip>` 5, `contact:user:<sub>` 5, `contact:global` 50) — upsert ตามลำดับ key ใน transaction เดียวกับการ insert ข้อความ; เกินแล้ว rollback ทั้งหมด จึงไม่นับคำขอที่ถูกปฏิเสธ
- error handler ใส่ header `Retry-After` ทุกครั้งที่ error มี `retryAfter`
- `src/services/notifier.ts`: webhook Discord/Slack (`CONTACT_WEBHOOK_URL`, timeout 5s, ตัดข้อความ ≤ 1900 ตัว) ยิงหลัง commit แบบไม่รอ; ล้มเหลวแค่ log warn โดยไม่มี PII; ไม่ตั้ง URL = noop
- `src/services/rate-limit-janitor.ts`: ลบหน้าต่างเก่ากว่า 1 ชั่วโมงทุก 10 นาที (เริ่ม/หยุดใน `server.ts`)
- `buildApp` รับ `notifier` และ `clock` (ใช้ในเทสไม่ให้ข้ามขอบหน้าต่าง)
- QA: unit 56/56, integration 53/53 (รวมยิงพร้อมกัน 60 คำขอได้ 202 พอดี 50), `make lint`, `make contract` ผ่าน

## [2026-10-11 16:30] feat-011: Automated Contract & E2E Integration Test Suite

- `test/helpers/contract.ts`: โหลด `contracts/openapi.yaml` เข้า Ajv 2020 (+ ajv-formats) แล้วตรวจ response จริง: status ต้องประกาศไว้ (หรือ 5XX), body ผ่าน JSON Schema (resolve `$ref` ของ components/responses), header บังคับ (เช่น `Retry-After`) และ 204 ต้องไม่มี body
- `test/integration/contract.test.ts` บน PostgreSQL จริง:
  - ทุก operation ในสัญญามี route จริง (`hasRoute`)
  - ทุก operation ที่มี security: ไม่มี token → 401 (ตรง schema); anonymous → 401 ยกเว้น `x-allow-anonymous`
  - 45+ scenario ครอบ 200/201/202/204/400/401/404/409/410/413/415/422/429/503 — ทุก response ตรวจกับสัญญา
- พบและแก้: `PUT /v1/me` ใช้เพดาน 1 KB แต่โปรไฟล์ที่ถูกต้องตาม schema ยาว ~2.6 KB ได้ → เพิ่ม `BODY_LIMITS.profile` 4 KB
- ช่องว่างของสัญญา (ไม่ได้แก้ openapi.yaml เพราะ sync มาจาก repo หลัก): `UNSUPPORTED_MEDIA_TYPE` อยู่ใน ErrorCode แต่ไม่มี 415 ใน responses ของ endpoint ใด — เทสตรวจ 415 ด้วยรูปแบบ Error แทน
- เพิ่ม devDependencies: `ajv`, `ajv-formats`, `yaml`
- QA: unit 56/56, integration 58/58, `make lint`, `make contract` ผ่าน

## [2026-10-11 16:55] feat-012: Docker Containerization, Railway Config & Backup Pipeline

- `Dockerfile` multi-stage (node:22-alpine) — token GitHub Packages ส่งผ่าน BuildKit secret (`npmrc` = `~/.npmrc` หรือ `NODE_AUTH_TOKEN`) ไม่ใช้ ARG/ENV; runtime เป็น user `node`, มี `HEALTHCHECK`; image 61 MB และตรวจแล้วไม่มี token ใน layer/ไฟล์
- `docker-compose.yml`: postgres 16 + api (migrate แล้ว start), bind 127.0.0.1; `make docker-up` build ด้วย, เพิ่ม `make docker-build`
- `railway.json`: build จาก Dockerfile, `preDeployCommand` migrate, health check `/health`
- `backup/`: `backup.sh` (pg_dump custom → `pg_restore --list` ตรวจ → อัปโหลด R2 → ลบไฟล์เกิน `BACKUP_RETENTION_DAYS`=30), `Dockerfile` (`PG_MAJOR` ให้ตรง server), `railway.json` cron `0 19 * * *` (02:00 ICT), ไฟล์ ignore เฉพาะ Dockerfile
- config: ตัวแปร optional ที่เป็นค่าว่าง (เช่น `${VAR:-}` จาก compose) นับเป็นไม่ได้ตั้ง
- QA: docker build ผ่าน; compose up → container healthy, ยิงคำขอแบบ BFF (JWT จริงผ่าน HTTP) ครบ flow me/layout/share/public/contact/delete; backup ไป S3-compatible (adobe/s3mock — MinIO ไม่มี image ให้ดึงแล้ว) สำเร็จ, retention ลบเฉพาะไฟล์เกิน 30 วัน, restore กลับ exit 0 และข้อมูลครบ, ขาด env → exit 64; ลบ container/volume/image ทดสอบแล้ว
- ยังไม่ได้ทดสอบกับ Cloudflare R2 จริง (ไม่มี credentials) และยังไม่ได้ deploy บน Railway — `preDeployCommand`/build secret บน Railway ต้องยืนยันตอน deploy ครั้งแรก
- README: หัวข้อ Deploy & Backup และวิธีกู้คืน; อัปเดตตาราง env

## [2026-10-14 22:00] feat-013: Identities Schema Migration

- `src/db/migrations/002-identities.ts`: เพิ่ม `email` ใน CHECK ของ users, ตาราง `identities` + index, backfill ผู้ใช้เดิมคนละแถว (`email_verified = false`, ไม่รวมอีเมลซ้ำ, ข้าม Guest และ id ที่ prefix ไม่ตรง provider)
- down ไม่ลบข้อมูลผู้ใช้: ถ้ามีผู้ใช้ provider `email` แล้วจะล้มและ rollback
- เทส integration `test/integration/migrations.test.ts` รัน 001 → insert ข้อมูลเดิม → 002 บน schema แยก; ตรวจ CHECK, cascade และ down
- harness ของ integration test TRUNCATE `identities` ด้วย; อัปเดต DDL/ER ใน `architecture.md`
- ยังไม่มี API — รอสัญญา identities/OTP จาก repo หลัก
- QA: unit 58/58, integration 61/61, `make lint`, `make contract`, format ผ่าน
