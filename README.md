# วางร้าน (Wang-Raan) Backend Service

> **Core Business Logic, Rule Engine & Persistence API for Wang-Raan**  
> บริการฝั่ง Backend สำหรับแพลตฟอร์มออกแบบและจัดผังร้านอาหาร **วางร้าน (Wang-Raan)**  
> รันบน Node.js 20 LTS (TypeScript ESM) ด้วย Fastify Framework และ PostgreSQL บน Railway (Singapore)

---

## 1. ภาพรวมระบบ (System Architecture)

`wang-raan-service` ทำหน้าที่เป็น Core Service และ Persistence Layer ให้บริการแก่ Next.js BFF (Backend For Frontend) บน Cloudflare Workers โดยไคลเอนต์ (Web Browser) จะไม่สามารถเข้าถึง Service นี้ได้โดยตรง

```
เบราว์เซอร์ ──cookie──▶ BFF (Next.js บน Cloudflare Workers) ──Bearer JWT──▶ Backend (Fastify บน Railway) ──▶ PostgreSQL
                                                                                │
                                                                       สำรองข้อมูลทุกคืน
                                                                                ▼
                                                                          Cloudflare R2
```

### หลักการความปลอดภัยและการทำงาน (Key Principles)
- **Zero-Trust Internal JWT:** ทุกคำขอ (ยกเว้น `GET /health`) ต้องยืนยันตัวตนด้วย Internal JWT (HS256) ผ่าน `INTERNAL_TOKEN_SECRET` (อายุ ≤ 300 วินาที)
- **User ID Isolation:** ระบุผู้ใช้ผ่าน `sub` จาก Token เท่านั้น ห้ามรับ User ID จาก Body หรือ Query Params เด็ดขาด
- **Multi-Tenant 404 Protection:** ทรัพยากรที่เป็นของผู้อื่น หรือไม่มีอยู่จริง จะตอบกลับ **`404 NOT_FOUND`** เสมอ (ไม่ใช้ 403) เพื่อป้องกันการเจาะสุ่ม ID
- **Dual-Tier Layout Validation:** ตรวจสอบความปลอดภัยของผังร้านด้วย `@bosskantaponguttarawichien-boop/wang-raan-core` ก่อนบันทึกลงฐานข้อมูลเสมอ หากสถานะเป็น `blocked` จะปฏิเสธด้วย **`422 LAYOUT_BLOCKED`**
- **Strict OpenAPI Adherence:** ปฏิบัติตามสัญญา API ใน [`contracts/openapi.yaml`](./contracts/openapi.yaml) (v1.1.0) อย่างเคร่งครัด 100%

---

## 2. สแตกเทคโนโลยี (Tech Stack)

| ส่วน | เทคโนโลยีที่ใช้ |
|---|---|
| **Runtime & Language** | Node.js ≥ 20 LTS, TypeScript (Strict, Native ESM) |
| **HTTP Framework** | Fastify (High Throughput, Schema Validation, Pino JSON Logger) |
| **Database & Driver** | PostgreSQL (Railway Singapore) + Connection Pool (`pg`) |
| **Domain Rule Engine** | `@bosskantaponguttarawichien-boop/wang-raan-core` (GitHub Packages) |
| **Schema Validation** | Zod (`^3.25`) |
| **Authentication & Crypto** | `jose` (JWT HS256), Native Web Crypto API (`crypto.getRandomValues`) |
| **Contract Linter** | Redocly CLI (`@redocly/cli`) |
| **Test Runner** | Vitest |
| **Container & Deploy** | Docker Multi-stage Build, Railway, Cloudflare R2 (Backup) |

---

## 3. รายการ API Endpoints (OpenAPI v1.1.0)

ทุกคำขอต้องมี Header `X-Request-Id: <uuid>` และส่ง `Authorization: Bearer <internal_jwt>`

| Method | Path | หน้าที่ | สิทธิ์ Anonymous | สถานะสำเร็จ |
|---|---|---|:---:|:---:|
| `GET` | `/health` | ตรวจสอบสถานะ Server และการเชื่อมต่อ PostgreSQL | ✅ (ไม่ต้องมี Token) | `200 OK` |
| `POST` | `/v1/layouts` | บันทึกผังร้านใหม่ (ตรวจผังด้วย Rule Engine, โควตา 200 ผัง) | ❌ | `201 Created` |
| `GET` | `/v1/layouts` | ดึงรายการผังร้านทั้งหมดของตนเอง | ❌ | `200 OK` |
| `GET` | `/v1/layouts/{layoutId}` | ดึงข้อมูลผังร้านตาม ID | ❌ | `200 OK` |
| `PUT` | `/v1/layouts/{layoutId}` | อัปเดตผังร้านเดิม (ตรวจผังซ้ำ) | ❌ | `200 OK` |
| `DELETE` | `/v1/layouts/{layoutId}` | ลบผังร้าน และ cascade revoke ลิงก์แชร์ทั้งหมด | ❌ | `204 No Content` |
| `POST` | `/v1/layouts/{layoutId}/shares` | สร้างลิงก์แชร์ Snapshot ผังร้าน (43-char Base64URL) | ❌ | `201 Created` |
| `GET` | `/v1/layouts/{layoutId}/shares` | ดูรายการลิงก์แชร์ของผังร้านนี้ | ❌ | `200 OK` |
| `DELETE` | `/v1/shares/{shareKey}` | ยกเลิก (Revoke) ลิงก์แชร์ | ❌ | `204 No Content` |
| `PATCH` | `/v1/shares/{shareKey}` | ขยายหรือเปลี่ยนเวลาหมดอายุของลิงก์แชร์ | ❌ | `200 OK` |
| `GET` | `/v1/public/shares/{shareKey}` | เปิดดู Snapshot ผังร้านสาธารณะ (Strip ข้อมูลเจ้าของ) | ✅ | `200 OK` |
| `POST` | `/v1/contact-messages` | ส่งข้อความติดต่อทีมงาน (จำกัด Rate Limit บน DB) | ✅ | `202 Accepted` |
| `GET` | `/v1/me` | ดูโปรไฟล์ของผู้ใช้ | ❌ | `200 OK` |
| `PUT` | `/v1/me` | Upsert โปรไฟล์ผู้ใช้ | ❌ | `200 OK` |
| `DELETE` | `/v1/me` | ลบข้อมูลผู้ใช้และผังร้านทั้งหมดตามกฎหมาย PDPA | ❌ | `204 No Content` |
| `GET` | `/v1/me/export` | ส่งออกข้อมูลทั้งหมดของผู้ใช้ตามกฎหมาย PDPA | ❌ | `200 OK` |
| `POST` | `/v1/me/merge-guest` | โอนย้ายผังและลิงก์แชร์ของ Guest เข้าบัญชีจริง (Atomic) | ❌ | `200 OK` |

---

## 4. เริ่มต้นพัฒนาในเครื่อง (Getting Started)

### ความต้องการของระบบ (Prerequisites)
- **Node.js:** v20 LTS ขึ้นไป
- **npm:** v10 ขึ้นไป
- **Python:** 3.10+ (สำหรับรัน Harness Validators)
- **Docker & Docker Compose:** สำหรับรัน PostgreSQL ในเครื่อง

### การตั้งค่า Environment Variables
คัดลอกไฟล์ตัวอย่างและแก้ไขค่า:
```bash
cp .env.example .env
```

| ตัวแปร | ความหมาย | ตัวอย่าง |
|---|---|---|
| `PORT` | พอร์ตสำหรับ HTTP Server | `4000` |
| `INTERNAL_TOKEN_SECRET` | Secret คีย์สำหรับตรวจสอบ JWT จาก BFF (ต้องตรงกับ BFF) | `your-32-char-secret-key-here...` |
| `DATABASE_URL` | PostgreSQL Connection URL | `postgresql://postgres:postgres@localhost:5432/wangraan` |
| `CONTACT_WEBHOOK_URL` | Discord/Slack incoming webhook สำหรับแจ้งเตือนฟอร์มติดต่อ (ทางเลือก) | `https://discord.com/api/webhooks/...` |
| `APP_VERSION` | เวอร์ชันที่ `GET /health` รายงาน (ทางเลือก — ค่าเริ่มต้นจาก package.json) | `2026.10.11-abc1234` |
| `LOG_LEVEL` | ระดับ log ของ Pino (ทางเลือก) | `info` |

### คำสั่งประจำ (Makefile Commands)

```bash
make help        # แสดงคำสั่งทั้งหมด
make init        # ตรวจสอบความพร้อมของระบบและ Architectural Boundaries
make status      # ตรวจสอบสถานะงานใน Harness Feature List
make lint        # ตรวจสอบ Code Standards, Boundaries และ OpenAPI Spec
make contract    # ตรวจสอบความถูกต้องของสัญญา API ด้วย Redocly
make test        # รัน Unit Tests + Integration/Contract Tests (PostgreSQL ชั่วคราวผ่าน Docker หรือ TEST_DATABASE_URL)
make dev         # เริ่มต้น Server ในโหมด Development
make build       # คอมไพล์ TypeScript สำหรับ Production
make docker-up   # build และรัน API + PostgreSQL ผ่าน Docker Compose (http://localhost:4000)
make docker-down # หยุดการทำงานของ Local Docker Compose
make docker-build # build production image (ใช้ ~/.npmrc เป็น BuildKit secret)
```

### Deploy & Backup

- **Image:** `Dockerfile` multi-stage, รันด้วย user `node`, ไม่มี token ใน image — token ของ GitHub Packages ส่งผ่าน BuildKit secret
  `npmrc` (ไฟล์ `~/.npmrc`) หรือ `NODE_AUTH_TOKEN` (env)
- **Railway (API):** `railway.json` — build จาก `Dockerfile`, `preDeployCommand` รัน migration, health check ที่ `/health`
  ตั้ง `DATABASE_URL`, `INTERNAL_TOKEN_SECRET`, `NODE_AUTH_TOKEN` (build secret) และ `APP_VERSION`/`CONTACT_WEBHOOK_URL` ตามต้องการ
- **Railway (Backup cron):** service แยกที่ใช้ `backup/railway.json` — `backup/backup.sh` รันทุกวัน 02:00 ICT:
  `pg_dump` → ตรวจไฟล์ด้วย `pg_restore --list` → อัปโหลดขึ้น Cloudflare R2 → ลบไฟล์ที่เก่ากว่า `BACKUP_RETENTION_DAYS` (30)
  - ตัวแปร: `DATABASE_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, (`BACKUP_PREFIX`, `BACKUP_RETENTION_DAYS`)
  - build arg `PG_MAJOR` ต้องตรงกับเวอร์ชันหลักของ PostgreSQL บน Railway (ค่าเริ่มต้น 16)
  - retention เกี่ยวกับ PDPA: ข้อมูลที่ผู้ใช้สั่งลบจะหายจาก backup เมื่อไฟล์ครบรอบ retention
- **กู้คืน:**
  ```bash
  aws --endpoint-url https://<account>.r2.cloudflarestorage.com s3 cp s3://<bucket>/wang-raan/<stamp>.dump ./restore.dump
  pg_restore --exit-on-error --no-owner -d "$TARGET_DATABASE_URL" ./restore.dump
  ```

---

## 5. ระบบ Harness และการบริหารจัดการโครงการ (Harness Operating System)

โครงการนี้ใช้ระบบ **Agent Harness Ecosystem** เพื่อควบคุมระเบียบการพัฒนาและติดตามสถานะงานอย่างเป็นระบบ:

- [`harness/feature_list.json`](./harness/feature_list.json) — แผนผังงานหลัก (Single Source of Truth)
- [`harness/progress.md`](./harness/progress.md) — บันทึกประวัติการดำเนินงานและ QA
- [`harness/session-handoff.md`](./harness/session-handoff.md) — เอกสารส่งมอบงานระหว่างเซสชัน
- [`AGENTS.md`](./AGENTS.md) — ระเบียบปฏิบัติและกฎสำคัญสำหรับ AI Agent
- [`SKILL.md`](./SKILL.md) — กฎเหล็กด้านวิศวกรรมและเช็กลิสต์คุณภาพก่อนส่งมอบงาน
- [`architecture.md`](./architecture.md) — เอกสารสถาปัตยกรรมทางเทคนิคฉบับสมบูรณ์
- [`BACKEND_HANDOFF.md`](./BACKEND_HANDOFF.md) — ข้อกำหนดการเชื่อมต่อกับ BFF
