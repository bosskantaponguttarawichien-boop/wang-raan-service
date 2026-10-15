# Session Handoff — วางร้าน (Wang-Raan) Backend Service

> **archive**: เก็บ 5 entry ล่าสุดเท่านั้น — รายการก่อนหน้าจะถูกย้ายไปเก็บที่
> `harness/archive/session-handoff-archive.md`

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

## 2026-10-11 17:00 ICT — feat-006 ถึง feat-012 เสร็จ: Domain APIs, Contract Tests, Deploy

### Core & Dev
- ทุก endpoint ใน `contracts/openapi.yaml` v1.1.0 มี implementation แล้ว: `src/modules/{layouts,shares,users,contact,health}`
- pattern: routes → service (business rule, transaction) → repository (SQL ที่มี `owner_id` เสมอ); ตัวตนจาก `requireUserId(request)` เท่านั้น
- `withTransaction` + `lockUser` (advisory lock ต่อผู้ใช้) ใช้กับโควตาผัง, merge guest, PDPA delete; โควตาลิงก์ใช้ `FOR UPDATE` บนแถวผัง
- `ensureUser()` สร้างแถว users ขั้นต่ำก่อนเขียนข้อมูล (FK) — sub ที่ provider ไม่รู้จักตอบ 401
- Contact: rate limit fixed window บน `rate_limits` + webhook notifier (`CONTACT_WEBHOOK_URL`) + janitor ใน `server.ts`
- Deploy: `Dockerfile`, `docker-compose.yml`, `railway.json`, `backup/` (R2)

### QA
- `make test` = unit 57 + integration/contract 58 (PostgreSQL 16 ชั่วคราวผ่าน Docker หรือ `TEST_DATABASE_URL`)
- contract test ตรวจทุก response กับ openapi.yaml ด้วย Ajv และตรวจ security/x-allow-anonymous ทุก operation
- `make lint`, `make contract`, `make build`, `make docker-build` ผ่าน; compose + backup/restore ทดสอบด้วย Docker จริง

### Open Questions / Decisions to Confirm
- สัญญาไม่ได้ประกาศ 415 ใน responses ของ endpoint ใด (มีแค่ใน ErrorCode) — ควรเพิ่มใน openapi.yaml ของ repo หลัก
- `PUT /v1/me` ใช้เพดาน body 4 KB (สัญญาบอก "อื่น ๆ ≤ 1 KB" แต่โปรไฟล์ที่ถูกต้องยาวได้ ~2.6 KB)
- merge-guest ไม่ตรวจโควตา 200 ผัง (สัญญาไม่มี error ให้), ย้าย contact messages ของ Guest ไปด้วย
- `PUT /v1/me`: ฟิลด์ที่ไม่ส่ง = คงค่าเดิม, `provider` ต้องตรงกับ prefix ของ `sub`
- ยังไม่บังคับ `X-Client-IP` / rate limit บน public share (สัญญาไม่มีตัวเลข)
- gate ของ feat-005 ใน feature_list ไม่ตรงสัญญา (ยึดสัญญา)
- ยังไม่ได้ทดสอบ R2 จริงและยังไม่ได้ deploy Railway จริง (`preDeployCommand`, build secret `NODE_AUTH_TOKEN`)

### Next Steps
1. ทบทวนและ commit งาน feat-004 ถึง feat-012 (ยังไม่ได้ commit)
2. ตั้งค่า Railway (API + Postgres + backup cron) และ R2 bucket จริง แล้วทดสอบ deploy/backup ครั้งแรก
3. แจ้งทีม repo หลักเรื่องช่องว่างของสัญญา (415, เพดาน body ของโปรไฟล์)

## 2026-10-14 22:00 ICT — feat-013 เสร็จ: Identities Schema Migration (ยังไม่มี API)

### Core & Dev
- migration `002-identities`: เพิ่ม `email` ใน `users_provider_check`, สร้างตาราง `identities` (PK `(provider, provider_account_id)`, FK `user_id` ON DELETE CASCADE, email บังคับ normalize แล้ว), index `identities_user` และ `identities_verified_email`
- backfill ผู้ใช้เดิม `<provider>-<id>` คนละแถว `email_verified = false` — ไม่รวมบัญชีที่อีเมลซ้ำ, Guest และ id ที่ prefix ไม่ตรง provider ไม่ได้ identity
- down: ลบ `identities` แล้วคืน CHECK เดิม — ถ้ามีผู้ใช้ provider `email` แล้วจะล้มและ rollback (ตั้งใจไม่ลบบัญชีเงียบ ๆ)
- `sub` แบบ `usr-<uuid>` ผ่าน auth อยู่แล้ว (ตรวจแค่ความยาว) จึงไม่ต้องแก้ middleware

### QA
- `make test` (unit 58, integration 61 — มีเทส backfill บน schema แยกที่มีแค่ 001), `make lint`, `make contract`, format ผ่าน

- (00:35 รีวิว) `last_login_at` เป็น NOT NULL DEFAULT now() และ backfill จาก `users.updated_at` — สัญญา `Identity.lastLoginAt` ห้ามเป็น null

### ⚠️ Deploy
- Railway production เชื่อม GitHub repo นี้แล้ว (API + Postgres online) — **push/merge เข้า `main` = deploy production ทันที** และ `preDeployCommand` รัน migration กับฐานข้อมูลจริง
- ห้าม merge `feat/identities-migration` เข้า `main` จนกว่าสัญญา v1.3.0 ฝั่ง FE จะ merge และ endpoint พร้อม
- ยังไม่มี service backup cron บน Railway และบัญชียังเป็น Trial — ตั้งก่อนเปิดใช้จริง (แนะนำเปิด "Wait for CI" ใน Settings → Source)

### Open Questions / Decisions to Confirm
- สัญญา v1.3.0 อยู่บน branch `feat/login-projects` ของ repo หลัก (push แล้ว รอรีวิว) — ข้อที่ FE ตัดสินเองดู `harness/handoff-fe-accounts.md` §7 ของ repo หลัก
- `users.provider` ใน API ยังไม่รับ `email` (`AuthProvider` ในสัญญาปัจจุบันยังไม่มี) — เปิดใน DB ไว้ก่อน

### Next Steps
1. sync `contracts/openapi.yaml` เมื่อ repo หลัก merge สัญญา identities/OTP แล้ว
2. ทำ `resolve` + กฎผูกบัญชีด้วยอีเมลที่ยืนยันแล้ว, แก้ `PUT /v1/me`, export/delete ให้ครอบคลุม identities

## 2026-10-15 ICT — feat-014 เสร็จ: สัญญา v1.3.0 ครบ (branch `feat/identities-migration`)

- endpoint ใหม่ทั้งหมดตามสัญญา v1.3.0 + ชื่อผัง + แบ่งหน้า — E2E ของ repo หลักผ่าน 90/90 กับ Backend นี้
- ⚠️ ก่อน merge เข้า `main` (= deploy production ทันที):
  1. ตั้ง `RESEND_API_KEY` + `MAIL_FROM` บน Railway (ไม่ตั้ง = ล็อกอินด้วยอีเมลไม่ได้ ตอบ 503) — โดเมนส่งเมลยังไม่ได้ตัดสิน
  2. deploy คู่กับ FE PR #11: FE บน `main` ตอนนี้ยังเรียก `PUT /v1/me` พร้อม `provider` → จะได้ 400 (แผงบัญชีของ FE เก่าขึ้น error จนกว่า FE ใหม่จะ deploy)
  3. migration 002 + 003 รันกับฐานข้อมูลจริงอัตโนมัติ (`preDeployCommand`)
- FE CI job "E2E (Backend จริง)" ต้องตั้ง `OTP_TEST_CODE=123456` ตอนเปิด Backend (แก้ใน repo หลักแล้ว)

## 2026-10-15 13:30 ICT — แก้ token รั่วใน build log + migration ไม่รันตอน deploy (ยังไม่ commit)

- **Token รั่ว:** `RUN` ใน stage deps เคยอ้าง `NODE_AUTH_TOKEN` ในข้อความคำสั่ง → build log บน Railway พิมพ์ค่าออกมา
  แก้เป็น `COPY docker/npmrc` (placeholder) + `RUN NPM_CONFIG_USERCONFIG=/tmp/auth.npmrc npm ci` — npm อ่านค่าจาก env เอง
  ตรวจแล้ว: build ในเครื่องด้วย token จริง พบค่า token 0 ครั้งใน build log และ history; npm แทน placeholder ได้ (ทดสอบกับ echo server)
  ⚠️ token ใน `~/.npmrc` ของเครื่องนี้ใช้ไม่ได้แล้ว (401) — build image ในเครื่องจนจบยังไม่ได้
- **Migration ไม่รัน:** `railway config migrate status` → "No services in production read Config as Code" = service ไม่ได้อ่าน `railway.json`
  (serviceManifest ไม่มีค่าจากไฟล์เลย: preDeployCommand/startCommand/healthcheckPath = null, restart retries 10 ไม่ใช่ 5)
  แก้: CMD ของ image รัน `migrate.js up && exec server.js` (เหมือน docker-compose) · เอา `preDeployCommand`/`startCommand` ออกจาก `railway.json`
  ⚠️ healthcheck `/health` ยังไม่ถูกตั้งบน service — ตั้งใน dashboard หรือย้ายไป IaC (`railway config migrate`) ภายหลัง
- `make test` 86/86, `make lint`, `make contract`, `./harness/init.sh` ผ่าน
