# สัญญา API: BFF ↔ Backend

คู่มือนี้สำหรับคนสร้าง **Backend ของวางร้าน** (repo แยก, TypeScript)
สัญญาฉบับเต็มอยู่ที่ [`openapi.yaml`](./openapi.yaml) (OpenAPI 3.1) — ถ้าคู่มือนี้กับ `openapi.yaml` ขัดกัน ให้ถือ `openapi.yaml`

| ไฟล์ | ใช้ทำอะไร |
|---|---|
| `openapi.yaml` | สัญญา: ทุก endpoint, body, response, error |
| `openapi.test.ts` | เทสต์ฝั่ง FE ว่า schema ในสัญญาตรงกับ Zod ที่ใช้จริง |
| `redocly.yaml` | กฎตรวจรูปแบบสัญญา (`make contract`) |

ดูสัญญาแบบหน้าเว็บอ่านง่าย:

```bash
npx redocly preview-docs contracts/openapi.yaml
```

---

## 1. ภาพรวม

```
เบราว์เซอร์ ──cookie──▶ BFF (Next.js บน Cloudflare) ──Bearer token──▶ Backend (Railway) ──▶ Postgres
```

- เบราว์เซอร์ **ไม่เรียก Backend ตรง** — ทุกคำขอผ่าน BFF
- BFF จัดการล็อกอิน (Auth.js) แล้วบอก Backend ว่า "ผู้ใช้คนนี้คือใคร" ผ่าน internal token
- Backend เป็นเจ้าของข้อมูลทั้งหมด และตรวจผังซ้ำก่อนบันทึกเสมอ

## 2. การยืนยันตัวตน (internal token)

ทุกคำขอ (ยกเว้น `GET /health`) มี header:

```
Authorization: Bearer <JWT>
```

JWT เซ็นแบบ **HS256** ด้วย secret เดียวกันทั้งสองฝั่ง (`INTERNAL_TOKEN_SECRET`) มี claim:

| claim | ค่า |
|---|---|
| `iss` | `wang-raan-bff` |
| `aud` | `wang-raan-backend` |
| `sub` | id ผู้ใช้ หรือ `anonymous` |
| `iat` / `exp` | อายุ 300 วินาที |

รูปแบบ id ผู้ใช้: `guest-<uuid>` (ผู้ใช้ทั่วไป) หรือ `<provider>-<providerAccountId>` เช่น `google-1234`, `line-U9f…`

ตัวอย่างการตรวจด้วย [`jose`](https://github.com/panva/jose):

```ts
import { jwtVerify } from "jose";

const key = new TextEncoder().encode(process.env.INTERNAL_TOKEN_SECRET);

export async function userFrom(request: Request): Promise<string | null> {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  try {
    const { payload } = await jwtVerify(auth.slice(7), key, {
      algorithms: ["HS256"],
      issuer: "wang-raan-bff",
      audience: "wang-raan-backend",
      clockTolerance: 5,
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null; // → 401 UNAUTHORIZED
  }
}
```

กติกา:
- token ไม่มี / ผิด / หมดอายุ → **401**
- `sub` = `anonymous` ใช้ได้เฉพาะ endpoint ที่มี `x-allow-anonymous: true` (เปิดลิงก์แชร์, ส่งฟอร์มติดต่อ) — ที่อื่นตอบ **401**
- ห้ามรับ id ผู้ใช้จาก body หรือ query — ใช้ `sub` เท่านั้น

## 3. Header อื่น ๆ

| Header | มีเมื่อ | ใช้ทำอะไร |
|---|---|---|
| `X-Request-Id` | ทุกคำขอ | UUID ต่อคำขอ — ใส่ใน log ทุกบรรทัด จะไล่ปัญหาข้าม BFF/Backend ได้ |
| `X-Client-IP` | เปิดลิงก์แชร์, ส่งฟอร์มติดต่อ | IP จริงของผู้ใช้ (BFF คำนวณให้แล้ว) ใช้นับ rate limit |
| `Content-Type: application/json` | คำขอที่มี body | ไม่ใช่ JSON → 415 |

## 4. Endpoint ทั้งหมด

| Method | Path | ทำอะไร | anonymous |
|---|---|---|---|
| GET | `/health` | สถานะระบบ + ฐานข้อมูล (ไม่ต้องมี token) | — |
| GET | `/v1/layouts` | รายการผังของผู้ใช้ (ใหม่สุดก่อน) | |
| POST | `/v1/layouts` | บันทึกผังใหม่ | |
| GET | `/v1/layouts/{layoutId}` | เปิดผัง | |
| PUT | `/v1/layouts/{layoutId}` | บันทึกทับ | |
| DELETE | `/v1/layouts/{layoutId}` | ลบผัง + ยกเลิกลิงก์แชร์ของผังนั้น | |
| GET | `/v1/layouts/{layoutId}/shares` | ลิงก์แชร์ของผัง | |
| POST | `/v1/layouts/{layoutId}/shares` | สร้างลิงก์แชร์ (snapshot) | |
| PATCH | `/v1/shares/{shareKey}` | เปลี่ยนวันหมดอายุ | |
| DELETE | `/v1/shares/{shareKey}` | ยกเลิกลิงก์ | |
| GET | `/v1/public/shares/{shareKey}` | เปิดผังจากลิงก์แชร์ | ✅ |
| POST | `/v1/contact-messages` | บันทึกข้อความติดต่อ | ✅ |
| GET | `/v1/me` | โปรไฟล์ | |
| PUT | `/v1/me` | สร้าง/อัปเดตโปรไฟล์ (BFF เรียกทุกครั้งที่ล็อกอิน) | |
| DELETE | `/v1/me` | ลบบัญชี + ข้อมูลทั้งหมด (PDPA) | |
| GET | `/v1/me/export` | ดาวน์โหลดข้อมูลทั้งหมด (PDPA) | |
| POST | `/v1/me/merge-guest` | ย้ายผังจากบัญชี Guest เข้าบัญชีนี้ | |

## 5. หน้าที่ของ Backend (สำคัญ)

1. **ตรวจผังซ้ำทุกครั้ง** — parse body ด้วย `StoreLayoutSchema` แล้วคำนวณผลตรวจด้วย `validateLayout()` จาก `@bosskantaponguttarawichien-boop/wang-raan-core`
   (ได้จาก feat-037) ห้ามเชื่อผลตรวจจาก BFF — สัญญาจึงรับแค่ `{ layout }`
   ผล `blocked` → 422 `LAYOUT_BLOCKED` และไม่บันทึก
   JSON Schema ใน `openapi.yaml` ตรวจ "id วัตถุซ้ำ" ไม่ได้ ต้องใช้ Zod เท่านั้น
2. **เห็นแค่ของตัวเอง** — ผังหรือลิงก์ของคนอื่นตอบ **404** (ไม่ใช่ 403) จะได้ไม่บอกว่ามีอยู่
3. **id ผังไม่ซ้ำภายในผู้ใช้คนเดียวกัน** — ผู้ใช้ต่างคนใช้ id เดียวกันได้ (key หลักคือ `owner_id + id`)
4. **ลิงก์แชร์**
   - `shareKey` = สุ่ม 32 ไบต์จาก `crypto.getRandomValues` → base64url (43 ตัวอักษร)
   - เก็บ snapshot ของผังและผลตรวจตอนกดแชร์ แก้ผังทีหลังลิงก์เดิมไม่เปลี่ยน
   - ยกเลิก = ตั้ง `revokedAt` (ไม่ลบแถว) หน้าแชร์จะตอบ 410 `SHARE_REVOKED` ได้
   - หมดอายุ → 410 `SHARE_EXPIRED`; `expiresAt` ต้องอยู่ในอนาคตและไม่เกิน 365 วัน
   - ลิงก์ที่ใช้งานได้ต่อผัง ≤ 20
   - response สาธารณะห้ามมี id เจ้าของ
5. **ขนาด body**: ผัง ≤ 512 KB, ข้อความติดต่อ ≤ 8 KB, อื่น ๆ ≤ 1 KB → 413
6. **โควตา**: ผังต่อผู้ใช้ ≤ 200 → 409 `LAYOUT_LIMIT_REACHED`
7. **Rate limit** (เก็บใน Postgres หรือ Redis ไม่ใช่หน่วยความจำ):
   - ฟอร์มติดต่อ: 5 ครั้ง/10 นาที ต่อ `X-Client-IP`, 5 ครั้ง/10 นาที ต่อผู้ใช้ที่ล็อกอิน, รวมทั้งระบบ 50 ครั้ง/10 นาที
   - เกิน → 429 `RATE_LIMITED` + header `Retry-After` + `retryAfter` ใน body
8. **ลบบัญชี** (`DELETE /v1/me`): ลบโปรไฟล์ ผัง ลิงก์แชร์ และข้อความติดต่อของผู้ใช้ถาวร เรียกซ้ำได้
9. **ย้ายผัง Guest** (`POST /v1/me/merge-guest`): ย้ายผังและลิงก์ทั้งหมด → id ที่ชนให้ตั้งใหม่และรายงานใน `renamed` → ลบบัญชี Guest
   ถ้า `sub` เป็น Guest เอง → 400
10. **เวลา**: ISO-8601 UTC เช่น `2026-10-10T06:00:00.000Z`

## 6. รูปแบบ Error

ทุก error ใช้รูปแบบเดียวกัน (เหมือนที่ BFF ตอบเบราว์เซอร์):

```json
{ "error": { "code": "NOT_FOUND", "message": "layout not found" } }
```

`message` ไว้สำหรับ log/นักพัฒนา — ข้อความภาษาไทยที่ผู้ใช้เห็น BFF เลือกจาก `code`

| code | HTTP | เมื่อไหร่ |
|---|---|---|
| `UNAUTHORIZED` | 401 | token ไม่ผ่าน หรือ anonymous ในที่ที่ต้องมีผู้ใช้ |
| `NOT_FOUND` | 404 | ไม่พบ หรือเป็นของคนอื่น |
| `INVALID_REQUEST` | 400 | body/parameter ผิด (แนบ `details`) |
| `INVALID_JSON` | 400 | JSON พัง |
| `INVALID_LAYOUT_SCHEMA` | 400 | ผังผิดโครงสร้าง (แนบ `details`) |
| `ID_MISMATCH` | 400 | id ใน path กับ body ไม่ตรงกัน |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | ไม่ใช่ JSON |
| `PAYLOAD_TOO_LARGE` | 413 | body ใหญ่เกิน |
| `LAYOUT_BLOCKED` | 422 | ผังไม่ผ่านกฎจำเป็น (แนบ `validation`, `issues`) |
| `LAYOUT_EXISTS` | 409 | POST ซ้ำ id เดิม |
| `LAYOUT_LIMIT_REACHED` | 409 | ผังครบ 200 |
| `SHARE_LIMIT_REACHED` | 409 | ลิงก์ครบ 20 |
| `SHARE_REVOKED` | 410 | ลิงก์ถูกยกเลิก |
| `SHARE_EXPIRED` | 410 | ลิงก์หมดอายุ |
| `RATE_LIMITED` | 429 | ถี่เกิน (แนบ `retryAfter`) |
| `INTERNAL_ERROR` | 5xx | ข้อผิดพลาดภายใน หรือไม่พร้อมชั่วคราว (503) — ห้ามแนบ stack trace; BFF ลองซ้ำเฉพาะ GET 1 ครั้ง |

## 7. ตารางในฐานข้อมูลที่แนะนำ (ไม่บังคับ)

| ตาราง | คอลัมน์หลัก |
|---|---|
| `users` | `id` (PK), `provider`, `name`, `email`, `image`, `created_at`, `updated_at` |
| `layouts` | `owner_id` + `id` (PK รวม), `layout` (jsonb), `validation` (jsonb), `created_at`, `updated_at` |
| `share_links` | `share_key` (PK), `owner_id`, `layout_id`, `layout` (jsonb snapshot), `validation` (jsonb), `created_at`, `expires_at`, `revoked_at` |
| `contact_messages` | `id`, `user_id` (null ได้), `name`, `email`, `message`, `client_ip`, `received_at` |
| `rate_limits` | `key`, `window_start`, `count` |

เก็บผังเป็น `jsonb` ทั้งก้อน — ผังถูกอ่าน/เขียนทั้งฉบับเสมอ ไม่ต้องแตกเป็นหลายตาราง

## 8. เช็กว่า Backend ตรงสัญญา

- ใน repo Backend ใช้ `openapi.yaml` ตรวจ response ในเทสต์ เช่น โหลด schema ด้วย `ajv` แบบที่ `openapi.test.ts` ทำ
- ฝั่ง FE มี Backend จำลองตามสัญญา (feat-038) และจะรัน E2E กับ Backend จริงบน staging (feat-046)
- checklist ฝั่ง Backend ก่อนต่อระบบ: `harness/sprint-2.md` หัวข้อ "ฝั่ง BE"

## 9. Backend จำลอง (ฝั่ง FE)

repo หน้าเว็บมี Backend จำลองตามสัญญาที่ `mock-backend/` (ข้อมูลอยู่ในหน่วยความจำ) — ใช้ดูพฤติกรรมที่คาดไว้ได้

```bash
npm run mock:build && INTERNAL_TOKEN_SECRET=dev npm run mock:start   # http://localhost:4010
```

- ทุกคำขอ/คำตอบในเทสต์ของ FE ผ่าน `contracts/contract-checker.ts` — ผิดสัญญาแล้วเทสต์ไม่ผ่าน
- ใช้ตัวตรวจเดียวกันนี้ใน repo Backend ได้: ห่อ fetch handler ด้วย `contractFetch()` แล้วตรวจ `violations` ว่าง
- `/__mock/*` เป็นคำสั่งควบคุมของเทสต์เท่านั้น — Backend จริงไม่ต้องมี

## 10. การเปลี่ยนสัญญา

- แก้ `openapi.yaml` ใน repo นี้ก่อนเสมอ แล้ว `make contract` + `make test` ต้องผ่าน
- เพิ่มฟิลด์ที่ไม่บังคับ / endpoint ใหม่ → เพิ่ม `info.version` ระดับ minor (1.1.0)
- เปลี่ยนหรือลบของเดิม (breaking) → ทำ path ใหม่ใต้ `/v2` แล้วค่อยเลิกใช้ `/v1` เมื่อทั้งสองฝั่งย้ายเสร็จ
