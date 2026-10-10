# SKILL.md — กฎการพัฒนาและเช็กลิสต์คุณภาพสำหรับ wang-raan-service

> เอกสารฉบับนี้เป็นคู่มือสรุป **กฎเหล็กด้านวิศวกรรม Backend (Engineering Standards)**, **สถาปัตยกรรมโมดูล** และ **เช็กลิสต์การส่งมอบงาน**
> สำหรับ Service วางร้าน (`wang-raan-service`) ที่ต้องปฏิบัติตามอย่างเคร่งครัด

---

## 1. กฎเหล็กการพัฒนา Backend (Inviolable Engineering Rules)

1. **Zero-Trust JWT Verification:**
   - ทุกคำขอยกเว้น `GET /health` ต้องมี Header `Authorization: Bearer <token>`
   - ตรวจสอบลายเซ็นอัลกอริทึม `HS256` ด้วย `INTERNAL_TOKEN_SECRET`
   - ตรวจสอบ Claims บังคับ: `iss === "wang-raan-bff"`, `aud === "wang-raan-backend"`
   - อายุ Token ต้องไม่เกิน 300 วินาที (ยอมรับ Clock skew ±5 วินาที)
   - หาก Token ไม่ถูกต้อง, หมดอายุ หรือไม่มี ส่งกลับ **`401 UNAUTHORIZED`** ทันที

2. **ห้ามรับ User ID จากไคลเอนต์เด็ดขาด (User ID Isolation):**
   - ผู้ใช้คือใครต้องมาจาก Claim `sub` ของ Token เสมอ
   - **ห้าม** อ่าน User ID จาก Request Body, Query Parameters หรือ URL Path เด็ดขาด

3. **Anonymous Access Isolation:**
   - `sub === "anonymous"` อนุญาตเฉพาะ Endpoint ที่ระบุ `x-allow-anonymous: true` ใน OpenAPI:
     - `GET /v1/public/shares/{shareKey}`
     - `POST /v1/contact-messages`
   - หากพบ `sub === "anonymous"` ใน Endpoint อื่น ต้องตอบกลับด้วย **`401 UNAUTHORIZED`** ทันที

4. **Multi-Tenant 404 Protection (ห้ามตอบ 403):**
   - ทุกคำขอที่เข้าถึงทรัพยากร (`layouts`, `shares`) ต้องมีเงื่อนไข `WHERE owner_id = :userId` ใน SQL เสมอ
   - หากผู้ใช้พยายามเข้าถึงทรัพยากรของผู้อื่น หรือไม่มีอยู่จริง ต้องส่งกลับ **`404 NOT_FOUND`** เสมอ (**ห้ามตอบ 403 FORBIDDEN**) เพื่อป้องกันการทำ Enumeration Attack

5. **Dual-Tier Layout Validation:**
   - ทุกการบันทึกผังร้าน (`POST /v1/layouts`, `PUT /v1/layouts/{layoutId}`) ต้อง:
     1. Parse โครงสร้างด้วย `StoreLayoutSchema` (Zod)
     2. คำนวณผลตรวจความปลอดภัยด้วย `validateLayout(layout)` จาก `@bosskantaponguttarawichien-boop/wang-raan-core`
   - หากสถานะเป็น `blocked` **ห้ามบันทึกลงฐานข้อมูลเด็ดขาด** และต้องตอบกลับด้วย **`422 LAYOUT_BLOCKED`** พร้อมแนบข้อมูล `validation` และ `issues`
   - อนุญาตให้บันทึกได้เฉพาะเมื่อสถานะเป็น `ready` หรือ `warning` เท่านั้น

6. **100% OpenAPI v1.1.0 Compliance:**
   - ทุก Endpoint, HTTP Method, Path Params, Headers, Body Schemas, Status Codes และ Error Codes ต้องตรงตาม [`contracts/openapi.yaml`](./contracts/openapi.yaml) อย่างสมบูรณ์

7. **Uniform Error Structure:**
   - โครงสร้าง Error Response ทุกตัวต้องสอดคล้องกับมาตรฐาน:
     ```json
     {
       "error": {
         "code": "ERROR_CODE",
         "message": "Human-readable English description for logging/debugging",
         "details": [],
         "retryAfter": 60,
         "validation": {},
         "issues": []
       }
     }
     ```

8. **Atomic Database Transactions:**
   - การทำงานที่กระทบหลายตารางหรือหลายขั้นตอนต้องรันภายใต้ Database Transaction (`BEGIN ... COMMIT`) เสมอ:
     - การควบรวม Guest เข้ากับบัญชีจริง (`POST /v1/me/merge-guest`)
     - การลบผังร้านพร้อม Cascade Revoke ลิงก์แชร์ทั้งหมด (`DELETE /v1/layouts/{layoutId}`)
     - การลบข้อมูลผู้ใช้ตาม PDPA (`DELETE /v1/me`)

9. **Database-backed Rate Limiter บน PostgreSQL:**
   - Endpoint สาธารณะ `POST /v1/contact-messages` ต้องใช้ Fixed Window 10 นาที บนตาราง `rate_limits`:
     - IP Window: `contact:ip:<ip>` (Limit = 5)
     - User Window: `contact:user:<sub>` (Limit = 5, กรณีไม่ใช่ anonymous)
     - Global Window: `contact:global` (Limit = 50)
   - หากเกิน Limit ส่งกลับ `429 RATE_LIMITED` พร้อม Header `Retry-After: <seconds>`

10. **Pure Backend (No UI/DOM Dependencies):**
    - โค้ดทั้งหมดใน `src/` ต้องเป็น Pure Node.js / TypeScript เท่านั้น
    - **ห้าม** import React, ReactDOM, Next.js, Radix UI, Zustand หรือ Browser DOM APIs เด็ดขาด

11. **Strict Structured JSON Logging:**
    - บันทึก Log ทุกบรรทัดในรูปแบบ JSON ผ่าน Pino
    - ต้องมีฟิลด์ `requestId` จาก Header `X-Request-Id` กำกับเสมอ
    - ห้ามพิมพ์ PII, Token หรือ Sensitive Secrets ลงใน Log เด็ดขาด

---

## 2. โครงสร้างโมดูลและรูปแบบโค้ด (Module Architecture Conventions)

การจัดวางโค้ดใน `src/modules/` แบ่งออกตาม Domain ชัดเจน:

```
src/modules/<module-name>/
├── <module>.routes.ts       # กำหนด Fastify Route, URL, Method, Pre-handler (Auth)
├── <module>.schemas.ts      # Zod validation schemas สำหรับ Body, Params, Query, Response
├── <module>.controller.ts   # รับ Request, แปลง Input, เรียก Service, ส่ง Response
├── <module>.service.ts      # Core Business Logic, Rule Engine, Quota Check
└── <module>.repository.ts   # การติดต่อฐานข้อมูล PostgreSQL (SQL queries / pool)
```

### โควตาและข้อจำกัดของระบบ (System Limits)
- จำนวนผังร้านสูงสุดต่อผู้ใช้: **200 ผัง** (`409 LAYOUT_LIMIT_REACHED`)
- จำนวน Active Share Links ต่อผังร้าน: **20 ลิงก์** (`409 SHARE_LIMIT_REACHED`)
- ขนาด Payload ผังร้านสูงสุด: **512 KB** (`413 PAYLOAD_TOO_LARGE`)
- อายุสูงสุดของ Share Link: **365 วัน**

---

## 3. เช็กลิสต์ตรวจสอบคุณภาพก่อนส่งมอบงาน (Quality Assurance Checklist)

ก่อนปรับสถานะงานใน `harness/feature_list.json` เป็น `"done"` ทุกครั้ง ต้องผ่านการตรวจสอบครบทุกข้อ:

- [ ] **OpenAPI Contract Compliance:** Endpoint, Method, Header, Query, Request Body และ Response Schema ตรงตาม `contracts/openapi.yaml` 100%
- [ ] **Authentication & Access Verification:**
  - ไม่มี Token → ได้รับ `401 UNAUTHORIZED`
  - Token ผิดหรือหมดอายุ → ได้รับ `401 UNAUTHORIZED`
  - Anonymous เข้าถึง Private Route → ได้รับ `401 UNAUTHORIZED`
  - เข้าถึงทรัพยากรของผู้อื่น → ได้รับ `404 NOT_FOUND` (ไม่ใช่ 403)
- [ ] **Dual-Tier Validation Integrity:**
  - ผังร้านสถานะ `blocked` ถูกปฏิเสธด้วย `422 LAYOUT_BLOCKED` พร้อม Validation Payload
  - ผังร้านสถานะ `ready` หรือ `warning` บันทึกได้สำเร็จ
- [ ] **Boundary & Pure Backend Check:** รัน `make lint` ไม่พบการ import UI/React/DOM ใน `src/`
- [ ] **Contract Validation ผ่าน:** รัน `make contract` (Redocly Lint) ผ่าน 100%
- [ ] **Automated Test Suite:** รัน `make test` หรือ `npm test` ผ่านครบถ้วน
- [ ] **Harness State Updated:** อัปเดตสถานะใน `harness/feature_list.json` พร้อมใส่ `"evidence"` และบันทึกสรุปงานลง `harness/progress.md`
