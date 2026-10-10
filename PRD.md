# Product Requirements Document (PRD) — wang-raan-service

> **Project Name:** วางร้าน (Wang-Raan) Backend Service  
> **Repository:** `wang-raan-service`  
> **Target Audience:** Next.js BFF (Cloudflare Workers), Admin team, ทีมพัฒนา  
> **Source Specifications:** [`contracts/openapi.yaml`](./contracts/openapi.yaml) (v1.1.0), [`BACKEND_HANDOFF.md`](./BACKEND_HANDOFF.md), [`architecture.md`](./architecture.md)  
> **Version:** 1.1.0  
> **Status:** Active Development (Sprint 1 Active)  

---

## 1. บทนำและภาพรวมผลิตภัณฑ์ (Product Overview)

**วางร้าน (Wang-Raan)** เป็นแพลตฟอร์มเว็บแอปพลิเคชันสำหรับออกแบบและจัดผังร้านอาหาร คำนวณระยะห่าง (clearance), ความจุที่นั่ง (seating capacity), ทางสัญจร และความปลอดภัยตามหลักสรีรศาสตร์และข้อกำหนดอาคาร

`wang-raan-service` คือบริการฝั่ง **Backend API (REST Core Service)** แยกอิสระที่เขียนด้วย Node.js 20 LTS / TypeScript (Strict, Native ESM) รันบน Fastify Framework ใน Docker Container (Railway Singapore) เชื่อมต่อกับ Railway PostgreSQL โดยทำหน้าที่เป็น **Single Source of Truth** ในการจัดเก็บข้อมูลผังร้าน, จัดการสิทธิ์, บังคับใช้กฎความปลอดภัยของผังร้าน (Floor validation rules) และปฏิบัติตามกฎหมายคุ้มครองข้อมูลส่วนบุคคล (PDPA)

### บทบาทความสัมพันธ์ในระบบ (System Relationship & Topology)
- **Frontend / Web Browser:** ไม่ติดต่อกับ Backend โดยตรงเด็ดขาด
- **BFF (Backend for Frontend):** Next.js บน Cloudflare Workers ทำหน้าที่จัดการ Authentication (Auth.js) และส่งต่อคำขอผ่านเครือข่ายภายในด้วย Internal JWT Bearer Token (`HS256`) มายัง Backend
- **Backend Service (`wang-raan-service`):** ยืนยันตัวตน Internal Token, ตรวจสอบความถูกต้องของผังร้านซ้ำด้วย Core Rule Engine (`@bosskantaponguttarawichien-boop/wang-raan-core`), บันทึกข้อมูลลง PostgreSQL, จัดการ Snapshot สำหรับแชร์, จัดการ Rate Limiter และส่งต่อข้อความติดต่อ
- **Disaster Recovery:** สำรองฐานข้อมูลอัตโนมัติด้วย Cron `pg_dump` ส่งตรงไปยัง Cloudflare R2 ทุกคืน

---

## 2. วัตถุประสงค์และเป้าหมาย (Objectives & Goals)

1. **ความถูกต้องและปลอดภัยสูงสุด (Data Integrity & Safety):** ป้องกันไม่ให้ผังร้านที่ละเมิดกฎขั้นวิกฤต (Blocked Layouts) ถูกบันทึกลงระบบ แม้ว่าฝั่งไคลเอนต์หรือ BFF จะถูกข้ามการตรวจสอบ
2. **การแยกข้อมูลผู้ใช้อย่างเด็ดขาด (Multi-Tenant Isolation):** ผู้ใช้แต่ละคนต้องเข้าถึงเฉพาะผังและข้อมูลของตนเอง หากเรียกดูข้อมูลผู้อื่น ระบบต้องตอบกลับเป็น `404 Not Found` เสมือนไม่มีข้อมูล เพื่อป้องกัน ID Enumeration Attack
3. **การแชร์ผังร้านแบบไม่เปิดเผยตัวตน (Secure Public Sharing):** ผู้ใช้สามารถสร้างลิงก์แชร์ผังร้านในลักษณะ Snapshot ที่ไม่มีข้อมูลอัตลักษณ์เจ้าของหลุดออกไป พร้อมกำหนดวันหมดอายุและการยกเลิกสิทธิ์ (Revoke) ได้ทันที
4. **ความเข้ากันได้ 100% กับสัญญา OpenAPI (Strict Contract Compliance):** ทุก Endpoint, Status Code, และ Error Payload ต้องเป็นไปตามข้อตกลง [`contracts/openapi.yaml`](./contracts/openapi.yaml) v1.1.0 อย่างสมบูรณ์
5. **การปฏิบัติตาม PDPA (Privacy by Design):** รองรับฟังก์ชันดาวน์โหลดข้อมูลทั้งหมด (`/v1/me/export`) และลบข้อมูลผู้ใช้ออกจากระบบโดยสมบูรณ์ (`DELETE /v1/me`)

---

## 3. กลุ่มผู้ใช้งาน (User Personas & Actors)

| Actor | รูปแบบ `sub` ใน Token | รายละเอียดและสิทธิ์การเข้าถึง |
|---|---|---|
| **BFF Internal Worker** | — | Next.js บน Cloudflare Workers ยืนยันตัวตนด้วย Shared Secret JWT (`HS256`) ส่ง Header `X-Request-Id` และ `X-Client-IP` มาในทุกคำขอ |
| **Guest User** | `guest-<uuid>` | ผู้ใช้ที่ยังไม่ได้ล็อกอิน ทดลองออกแบบผังร้าน บันทึกผังได้ และสามารถโอนย้ายผังเข้าบัญชีจริงเมื่อล็อกอินภายหลัง |
| **Registered User** | `<provider>-<id>` | ผู้ใช้ล็อกอินผ่าน Google / LINE / GitHub จัดการผังร้านได้สูงสุด 200 ผัง แชร์ผัง และจัดการบัญชีตนเอง |
| **Public Viewer** | `anonymous` | บุคคลทั่วไปที่เปิดดูผังร้านผ่าน Public Share Link (`/v1/public/shares/{shareKey}`) หรือส่งฟอร์มติดต่อ (`/v1/contact-messages`) |
| **System Admin / Operations** | — | ทีมงานผู้ดูแลระบบ ตรวจสอบความสมบูรณ์ผ่าน `GET /health` และรับการแจ้งเตือนจากฟอร์มติดต่อผ่าน Webhook |

---

## 4. ขอบเขตฟังก์ชันและข้อกำหนดความต้องการ (Functional Requirements)

### FR-1: การตรวจสอบตัวตนและควบคุมการเข้าถึง (Authentication & Access Control)
- **FR-1.1:** ทุกคำขอ (ยกเว้น `GET /health`) ต้องแนบ `Authorization: Bearer <JWT>` ที่ลงนามด้วย `INTERNAL_TOKEN_SECRET`
- **FR-1.2:** Token ต้องมี `iss = wang-raan-bff`, `aud = wang-raan-backend`, อายุปกติไม่เกิน 300 วินาที (ยอมรับ Clock Skew ±5 วินาที)
- **FR-1.3:** กรณี Token เสียหาย หมดอายุ หรือไม่มี ส่งกลับ `401 UNAUTHORIZED`
- **FR-1.4:** กรณี `sub = anonymous` อนุญาตเฉพาะ Endpoint สาธารณะ (`GET /v1/public/shares/{shareKey}` และ `POST /v1/contact-messages`) หากพบใน Endpoint อื่นต้องตอบ `401 UNAUTHORIZED`
- **FR-1.5:** ห้ามรับ User ID จาก Body หรือ Query Params ทุกกรณี ให้อ้างอิงจาก `sub` เสมอ

### FR-2: การจัดการผังร้าน (Store Layout Management)
- **FR-2.1: ตรวจสอบความถูกต้อง (Rule Engine Validation):**
  - ทุกการบันทึก (`POST`, `PUT`) ต้องผ่านการ parse ด้วย `StoreLayoutSchema` และคำนวณผ่าน `validateLayout()` จากแพ็กเกจ `@bosskantaponguttarawichien-boop/wang-raan-core`
  - หากผลการตรวจเป็น `blocked` ระบบต้องปฏิเสธการบันทึกและตอบ `422 LAYOUT_BLOCKED` พร้อมแนบโครงสร้าง validation และรายการ issues
- **FR-2.2: การสร้างผังร้าน (`POST /v1/layouts`):**
  - ตรวจสอบโควตาผังร้านของผู้ใช้ (สูงสุดไม่เกิน 200 ผังต่อผู้ใช้) หากเกินตอบ `409 LAYOUT_LIMIT_REACHED`
  - ตรวจสอบความซ้ำซ้อนของ `id` ภายใต้ผู้ใช้คนเดียวกัน หากซ้ำตอบ `409 LAYOUT_EXISTS`
  - ตรวจสอบขนาด Body ไม่เกิน 512 KB หากเกินตอบ `413 PAYLOAD_TOO_LARGE`
- **FR-2.3: การอ่านผังร้าน (`GET /v1/layouts` & `GET /v1/layouts/{layoutId}`):**
  - รายการผังร้านเรียงลำดับตาม `updatedAt` ล่าสุดก่อน
  - หากค้นหา `layoutId` ไม่พบ หรือไม่ใช่ของผู้ใช้คนนั้น ต้องตอบ `404 NOT_FOUND` (ห้ามตอบ 403)
- **FR-2.4: การอัปเดตผังร้าน (`PUT /v1/layouts/{layoutId}`):**
  - `layout.id` ใน Body ต้องตรงกับ `layoutId` ใน Path Param หากไม่ตรงตอบ `400 ID_MISMATCH`
  - คงค่า `createdAt` เดิมไว้ และอัปเดต `updatedAt` เป็นเวลาปัจจุบัน
- **FR-2.5: การลบผังร้าน (`DELETE /v1/layouts/{layoutId}`):**
  - ลบผังร้านออกจากระบบ
  - ยกเลิกลิงก์แชร์ทั้งหมดที่เชื่อมโยงกับผังนั้นโดยการตั้งค่า `revokedAt = now()` ใน Database Transaction เดียวกัน

### FR-3: การแชร์ผังร้าน (Layout Sharing & Public Access)
- **FR-3.1: การสร้างและดูรายการลิงก์แชร์ (`POST`, `GET /v1/layouts/{layoutId}/shares`):**
  - สุ่ม `shareKey` 32 bytes ด้วย Cryptographically Secure RNG แปลงเป็น Base64URL ความยาว 43 ตัวอักษร
  - บันทึกแบบ Snapshot (สำเนา `layout` และ `validation` ณ ขณะนั้น) การแก้ไขผังในภายหลังต้องไม่มีผลกระทบต่อ snapshot เดิม
  - ผังร้านที่มีสถานะ validation เป็น `blocked` ไม่สามารถสร้างลิงก์แชร์ได้ (ตอบ `422 LAYOUT_BLOCKED`)
  - จำกัดจำนวน Active Share Links ไม่เกิน 20 ลิงก์ต่อผัง หากเกินตอบ `409 SHARE_LIMIT_REACHED`
  - รองรับการตั้ง `expiresAt` สูงสุดไม่เกิน 365 วัน (หากเป็น `null` ถือว่าไม่มีวันหมดอายุ)
- **FR-3.2: การยกเลิกและแก้ไขลิงก์แชร์ (`DELETE /v1/shares/{shareKey}`, `PATCH /v1/shares/{shareKey}`):**
  - การยกเลิก (Revoke) ให้บันทึกค่า `revokedAt = now()` รองรับ Idempotency (เรียกซ้ำตอบ 204)
  - เจ้าของสามารถขยายหรือเปลี่ยน `expiresAt` ได้ผ่าน `PATCH /v1/shares/{shareKey}`
- **FR-3.3: การเปิดดูผังแชร์สาธารณะ (`GET /v1/public/shares/{shareKey}`):**
  - อนุญาตการเข้าถึงแบบ Anonymous
  - หากลิงก์ถูกยกเลิก ตอบ `410 SHARE_REVOKED`
  - หากลิงก์หมดอายุ ตอบ `410 SHARE_EXPIRED`
  - หากไม่พบ ตอบ `404 NOT_FOUND`
  - **ข้อกำหนดความปลอดภัยขั้นเด็ดขาด:** ข้อมูลที่ส่งกลับต้องไม่มี `owner_id` หรือข้อมูลระบุตัวตนเจ้าของผัง

### FR-4: การจัดการผู้ใช้และการควบรวมบัญชี (User Identity & Guest Merge)
- **FR-4.1: การจัดการโปรไฟล์ (`GET`, `PUT /v1/me`):**
  - BFF จะเรียก `PUT /v1/me` เพื่อ upsert โปรไฟล์ทุกครั้งที่ผู้ใช้ล็อกอิน
  - หากมีคำขอสร้างผังจาก `guest-<uuid>` เข้ามาครั้งแรก ให้ทำ Lazy Provisioning สร้างผู้ใช้ guest อัตโนมัติ
- **FR-4.2: การควบรวม Guest เข้ากับบัญชีจริง (`POST /v1/me/merge-guest`):**
  - รับ `guestId` รูปแบบ UUID `guest-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
  - ป้องกันไม่ให้ `sub` ที่เป็น Guest ร้องขอการ Merge (ตอบ `400 INVALID_REQUEST`)
  - โอนย้าย `layouts` และ `share_links` ทั้งหมดจาก Guest ไปยังผู้ใช้ปัจจุบันใน Database Transaction เดียว
  - หาก `layout.id` ของ Guest ซ้ำกับผังเดิมของผู้ใช้ ให้สร้าง ID ใหม่แบบไม่ชน (`<id>-guest-copy`) และระบุประวัติในผลลัพธ์ `renamed: [{ from, to }]`
  - ลบบัญชี Guest ออกจากระบบหลังการโอนย้ายสำเร็จ หากเรียกซ้ำด้วย `guestId` เดิมให้ตอบสำเร็จพร้อม `movedLayouts: 0`
- **FR-4.3: การปฏิบัติตาม PDPA (`DELETE /v1/me` & `GET /v1/me/export`):**
  - `DELETE /v1/me`: ลบโปรไฟล์, ผังร้านทั้งหมด, ลิงก์แชร์, และข้อความติดต่อที่ผูกกับผู้ใช้ออกอย่างถาวร (Cascading Delete) สามารถเรียกซ้ำได้ (ตอบ 204)
  - `GET /v1/me/export`: ส่งออกข้อมูลทั้งหมดของผู้ใช้ในรูปแบบ JSON ตามสัญญา `AccountExport`

### FR-5: ฟอร์มติดต่อและการจำกัดอัตราการเรียก (Contact Form & Rate Limiting)
- **FR-5.1: การรับข้อความติดต่อ (`POST /v1/contact-messages`):**
  - รองรับ Anonymous และ Authenticated Users
  - รับข้อมูล `name` (1–80 ตัวอักษร), `email` (RFC format), `message` (10–2000 ตัวอักษร)
  - ตอบกลับ `202 Accepted` พร้อม ID และ `receivedAt`
- **FR-5.2: การควบคุมอัตราการเรียก (Rate Limiting Tier):**
  - ตรวจสอบผ่านตาราง `rate_limits` บน PostgreSQL แบบ Fixed Window 10 นาที (ห้ามเก็บใน in-memory):
    - ต่อ `X-Client-IP`: สูงสุด 5 ครั้ง ต่อ 10 นาที
    - ต่อ `sub` (กรณีล็อกอิน): สูงสุด 5 ครั้ง ต่อ 10 นาที
    - รวมทั้งระบบ (Global): สูงสุด 50 ครั้ง ต่อ 10 นาที
  - หากเกินขีดจำกัด ตอบ `429 RATE_LIMITED` พร้อมแนบ Header `Retry-After: <seconds>` และ JSON Body `error.retryAfter`
- **FR-5.3: การแจ้งเตือนทีมงาน:**
  - เมื่อได้รับข้อความ ต้องส่ง Notification ไปยัง Discord/Slack Webhook แบบ Asynchronous โดยไม่กระทบเวลาตอบกลับของผู้ใช้

### FR-6: การเฝ้าระวังและการตรวจสอบระบบ (Health & Observability)
- **FR-6.1: Health Endpoint (`GET /health`):**
  - ตรวจสอบสถานะการทำงานของตัวแอปพลิเคชันและการเชื่อมต่อฐานข้อมูล PostgreSQL
  - ใช้งานได้โดยไม่ต้องมี Token
  - ตอบ `200 OK` เมื่อฐานข้อมูลปกติ และ `503 Service Unavailable` หากไม่สามารถเชื่อมต่อฐานข้อมูลได้
- **FR-6.2: Structured Logging & Tracing:**
  - ทุก Log บรรทัดต้องมี `requestId` จาก Header `X-Request-Id` (หรือสร้างขึ้นใหม่หากไม่มี) ผ่าน Pino JSON logger
  - ห้ามพิมพ์ข้อมูล Sensitive เช่น JWT Secret, รหัสผ่าน, หรือ PII ลงใน Log

---

## 5. ข้อกำหนดด้านคุณภาพที่ไม่ใช่ฟังก์ชัน (Non-Functional Requirements: NFR)

| หมวดหมู่ | ข้อกำหนด | เป้าหมาย |
|---|---|---|
| **NFR-1: Performance** | P95 Response Time สำหรับการอ่าน/เขียนผังร้าน | < 100 ms (ไม่รวม Network latency ข้าม Region) |
| **NFR-2: Throughput** | อัตราการรองรับคำขอพร้อมกัน | รองรับอย่างน้อย 200 RPS บน Railway Standard Container |
| **NFR-3: Reliability** | Service Availability SLA | 99.9% uptime |
| **NFR-4: Data Backup** | การสำรองข้อมูลฐานข้อมูล | Automated Daily `pg_dump` สำรองขึ้น Cloudflare R2 กู้คืนข้าม Region ได้ภายใน 30 นาที (RTO < 30m, RPO < 24h) |
| **NFR-5: Payload Size** | ขนาดข้อมูลสูงสุดที่รองรับ | Layout ≤ 512 KB, Contact ≤ 8 KB, ทั่วไป ≤ 1 KB (ตอบ 413 เมื่อเกิน) |
| **NFR-6: Security** | มาตรฐานความปลอดภัยข้อมูล | ไม่มี Stack trace หลุดออกทาง API Response (5xx), ปฏิบัติตาม OWASP Top 10 API Security |

---

## 6. โครงสร้างข้อผิดพลาดมาตรฐาน (Error Handling Contract)

ระบบต้องตอบกลับรูปแบบข้อผิดพลาดมาตรฐานเดียวกันทุก Endpoint:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable English description for logging/debugging",
    "details": [
      { "path": "layout.width", "message": "width must be between 2 and 30" }
    ],
    "retryAfter": 60,
    "validation": { "status": "blocked", "issues": [] },
    "issues": []
  }
}
```

---

## 7. แผนงานการพัฒนาและ Harness Mapping (Implementation Roadmap)

งานทั้งหมดถูกติดตามผ่านระบบ Harness ใน [`harness/feature_list.json`](./harness/feature_list.json):

- **Sprint 1 (Infrastructure & Core Setup):**
  - `feat-000`: Harness & Agent Operating System Setup (Done ✅)
  - `feat-001`: Project Foundation, Fastify Bootstrap & Tooling
  - `feat-002`: Core Package & Contract Integration (`@wang-raan-core` + Zod)
  - `feat-003`: Database Infrastructure & Migrations Architecture (PostgreSQL)
  - `feat-004`: Security, Auth & Tracing Middleware (JWT HS256, Tracing, Payload Limiter)
  - `feat-005`: Health Check API (`GET /health`)
- **Sprint 2 (Domain APIs & Business Logic):**
  - `feat-006`: Layouts CRUD & Core Validation Engine (`/v1/layouts`)
  - `feat-007`: Share Links Management & Snapshots Engine (`/v1/layouts/{layoutId}/shares`, `/v1/shares/{shareKey}`)
  - `feat-008`: Public Share Viewer API (`GET /v1/public/shares/{shareKey}`)
  - `feat-009`: User Profile & PDPA Operations (`/v1/me`, `/v1/me/merge-guest`, `/v1/me/export`)
  - `feat-010`: Contact Messages & Database Rate Limiter (`POST /v1/contact-messages`)
- **Sprint 3 (Contract Testing & Production Deployment):**
  - `feat-011`: Automated Contract & E2E Integration Test Suite
  - `feat-012`: Docker Containerization, Railway Config & Backup Pipeline
