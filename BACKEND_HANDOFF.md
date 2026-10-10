# Backend Handoff — วางร้าน (Wang-Raan)

> สรุปทุกอย่างที่ Backend (repo แยก, TypeScript) ต้องรู้ เพื่อต่อกับหน้าเว็บ + BFF
> อ้างอิง: [`contracts/openapi.yaml`](contracts/openapi.yaml) (v1.1.0), [`contracts/README.md`](contracts/README.md), [`architecture.md`](architecture.md), [`PRD.md`](PRD.md)
> **ถ้าเอกสารนี้ขัดกับ `openapi.yaml` ให้ถือ `openapi.yaml`**

---

## 1. สแตกและภาพรวม

| ส่วน | ใช้อะไร |
|---|---|
| Backend | Node ≥ 20 + TypeScript ใน Docker — Railway (Singapore) |
| ฐานข้อมูล | Railway Postgres (Singapore) |
| Backup | dump ทุกคืน → Cloudflare R2 (backup ในตัวของ Railway กู้ข้ามโปรเจกต์/region ไม่ได้) |
| กฎตรวจผัง | `@bosskantaponguttarawichien-boop/wang-raan-core` — GitHub Packages (`https://npm.pkg.github.com`), peer dep `zod ^3.25` |
| พอร์ตในเครื่อง | `http://localhost:4000` (docker compose) |

```
เบราว์เซอร์ ──cookie──▶ BFF (Next.js บน Cloudflare Workers) ──Bearer JWT──▶ Backend (Railway) ──▶ Postgres
```

- เบราว์เซอร์ **ไม่เรียก Backend ตรง** — ทุกคำขอมาจาก BFF
- BFF จัดการล็อกอิน (Auth.js) แล้วบอก Backend ว่าผู้ใช้คือใครผ่าน internal token
- Backend เป็นเจ้าของข้อมูลทั้งหมด และตรวจผังซ้ำก่อนบันทึกเสมอ

ติดตั้ง core package (ต้องมี GitHub token ที่มีสิทธิ์ `read:packages`):

```
# .npmrc
@bosskantaponguttarawichien-boop:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```bash
npm install @bosskantaponguttarawichien-boop/wang-raan-core zod
```

## 2. Environment Variables (ฝั่ง Backend)

| ตัวแปร | ใช้ทำอะไร |
|---|---|
| `INTERNAL_TOKEN_SECRET` | ตรวจ JWT จาก BFF — **ต้องตรงกับค่าฝั่ง BFF** |
| `DATABASE_URL` | Postgres connection string (ชื่อเสนอ — สัญญาไม่กำหนด) |
| ค่าแจ้งเตือนฟอร์มติดต่อ | อีเมล / LINE / Slack — ยังไม่ได้ตัดสิน |

ฝั่ง BFF ตั้ง `WANGRAAN_BACKEND_URL` เป็น origin ของ Backend (ไม่ต้องมี `/v1`) เช่น `https://api.wangraan.com`

## 3. การยืนยันตัวตน (Internal Token)

ทุกคำขอ (ยกเว้น `GET /health`) มี `Authorization: Bearer <JWT>`

| claim | ค่า |
|---|---|
| alg | `HS256` เซ็นด้วย `INTERNAL_TOKEN_SECRET` |
| `iss` | `wang-raan-bff` |
| `aud` | `wang-raan-backend` |
| `sub` | id ผู้ใช้ หรือ `anonymous` |
| `iat` / `exp` | อายุ 300 วินาที (clock tolerance 5 วินาที) |

รูปแบบ id ผู้ใช้: `guest-<uuid>` หรือ `<provider>-<providerAccountId>` เช่น `google-1234`, `line-U9f…`

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
- `sub = anonymous` ใช้ได้เฉพาะ endpoint ที่มี `x-allow-anonymous: true` (เปิดลิงก์แชร์, ฟอร์มติดต่อ) — ที่อื่นตอบ **401**
- **ห้ามรับ id ผู้ใช้จาก body หรือ query** — ใช้ `sub` เท่านั้น

### Header อื่น ๆ

| Header | มีเมื่อ | ใช้ทำอะไร |
|---|---|---|
| `X-Request-Id` | ทุกคำขอ | UUID ต่อคำขอ — ใส่ใน log ทุกบรรทัด |
| `X-Client-IP` | เปิดลิงก์แชร์, ฟอร์มติดต่อ | IP จริงของผู้ใช้ (BFF คำนวณแล้ว) ใช้นับ rate limit |
| `Content-Type: application/json` | คำขอที่มี body | ไม่ใช่ JSON → 415 |

## 4. Endpoint ทั้งหมด

| Method | Path | ทำอะไร | สำเร็จ | anonymous |
|---|---|---|---|---|
| GET | `/health` | `{status: ok\|degraded, version, database?: ok\|unavailable}` ไม่ต้องมี token | 200 / 503 | — |
| GET | `/v1/layouts` | `{layouts: LayoutSummary[]}` เรียง `updatedAt` ใหม่สุดก่อน | 200 | |
| POST | `/v1/layouts` | body `{layout}` → `StoredLayout` | 201 | |
| GET | `/v1/layouts/{layoutId}` | → `StoredLayout` | 200 | |
| PUT | `/v1/layouts/{layoutId}` | body `{layout}` บันทึกทับ (`createdAt` คงเดิม) | 200 | |
| DELETE | `/v1/layouts/{layoutId}` | ลบผัง + revoke ลิงก์แชร์ของผังนั้น | 204 | |
| GET | `/v1/layouts/{layoutId}/shares` | `{shares: ShareLink[]}` รวมที่ยกเลิก/หมดอายุ ใหม่สุดก่อน | 200 | |
| POST | `/v1/layouts/{layoutId}/shares` | body `{expiresAt?}` → `ShareLink` (snapshot) | 201 | |
| PATCH | `/v1/shares/{shareKey}` | body `{expiresAt}` → `ShareLink` | 200 | |
| DELETE | `/v1/shares/{shareKey}` | ตั้ง `revokedAt` (เรียกซ้ำได้) | 204 | |
| GET | `/v1/public/shares/{shareKey}` | → `PublicShare` (**ห้ามมี id เจ้าของ**) | 200 | ✅ |
| POST | `/v1/contact-messages` | body `{name, email, message}` → `{id, receivedAt}` | 202 | ✅ |
| GET | `/v1/me` | → `User` (ไม่มี = 404) | 200 | |
| PUT | `/v1/me` | upsert โปรไฟล์ (BFF เรียกทุกครั้งที่ล็อกอิน) → `User` | 200 | |
| DELETE | `/v1/me` | ลบบัญชี + ข้อมูลทั้งหมด (PDPA) เรียกซ้ำได้ | 204 | |
| GET | `/v1/me/export` | → `AccountExport` (PDPA) | 200 | |
| POST | `/v1/me/merge-guest` | body `{guestId}` → `{movedLayouts, movedShares, renamed[]}` | 200 | |

ทุก endpoint (ยกเว้น `/health`) อาจตอบ 401, 429, 5xx ได้ — ดูรายละเอียด response ต่อ endpoint ใน `openapi.yaml`

## 5. Data Shapes (สรุป)

### ผังร้าน `StoreLayout` (หน่วยเมตร, จุด (0,0) = มุมตะวันตกเฉียงเหนือ)

| ฟิลด์ | ชนิด / ข้อจำกัด |
|---|---|
| `id` | string 1–128 |
| `version` | integer ≥ 1 |
| `units` | `"m"` |
| `width`, `depth` | 2–30, ลงกริด 0.25 |
| `entrance` | `{id, wall: north\|south\|east\|west, position: 0–30, width: 0.6–3}` หรือ `null` (null = Blocked) |
| `objects` | array ≤ 1000 ของ Kitchen / Counter / Table / Chair (แยกด้วย `type`) |

วัตถุทุกชนิดมี `id, type, x, y (-30–60), width, depth (>0–30), rotation (0\|90\|180\|270)`
- `table`: + `chairIds` (≤ 16), `preset?` (`table-2-seats` \| `table-4-seats`)
- `chair`: + `tableId`
- id วัตถุต้องไม่ซ้ำกัน — **ตรวจได้ด้วย Zod (`StoreLayoutSchema`) เท่านั้น**

### ผลตรวจ `ValidationResult`

```ts
{
  layoutRevision: string,
  status: "ready" | "warning" | "blocked",
  issues: { id, category: "completeness"|"collision"|"clearance"|"accessibility",
            severity: "blocked"|"warning", objectIds: string[], message }[],
  validatedAt: DateTime
}
```

### อื่น ๆ

| Schema | ฟิลด์ |
|---|---|
| `StoredLayout` | `layout, validation, createdAt, updatedAt` |
| `LayoutSummary` | `id, width, depth, objectCount, status, updatedAt` |
| `ShareLink` | `shareKey, layoutId, status (active\|expired\|revoked), createdAt, expiresAt\|null, revokedAt\|null` |
| `PublicShare` | `layout, validation, createdAt, expiresAt\|null` |
| `User` | `id, provider (guest\|google\|line\|github), name\|null (≤200), email\|null (≤254), image\|null (uri ≤2048), createdAt, updatedAt` |
| `UpsertProfileRequest` | `provider` (บังคับ), `name?, email?, image?` |
| `ContactMessageRequest` | `name` 1–80, `email` 1–254 (format email), `message` 10–2000 |
| `AccountExport` | `exportedAt, user, layouts: StoredLayout[], shares: ShareLink[], contactMessages: {name, email, message, receivedAt}[]` |
| `MergeGuestRequest` | `guestId` ตรง `^guest-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` |
| `MergeGuestResult` | `movedLayouts, movedShares, renamed: {from, to}[]` |

เวลาทั้งหมดเป็น ISO-8601 UTC เช่น `2026-10-10T06:00:00.000Z`

## 6. กฎธุรกิจที่ Backend ต้องบังคับ

1. **ตรวจผังซ้ำทุกครั้ง** — parse body ด้วย `StoreLayoutSchema` แล้วคำนวณผลด้วย `validateLayout()` จาก core package
   ห้ามเชื่อผลตรวจจาก BFF (สัญญาจึงรับแค่ `{ layout }`)
   ผล `blocked` → 422 `LAYOUT_BLOCKED` พร้อม `validation` + `issues` และ **ไม่บันทึก**
2. **เห็นแค่ของตัวเอง** — ผังหรือลิงก์ของคนอื่นตอบ **404** (ไม่ใช่ 403)
3. **id ผังไม่ซ้ำภายในผู้ใช้คนเดียวกัน** — key หลักคือ `owner_id + id`; POST ซ้ำ id → 409 `LAYOUT_EXISTS`
4. PUT ที่ `layout.id` ไม่ตรงกับ path → 400 `ID_MISMATCH`
5. **ลิงก์แชร์**
   - `shareKey` = สุ่ม 32 ไบต์ด้วย `crypto.getRandomValues` → base64url (43 ตัวอักษร `^[A-Za-z0-9_-]{43}$`)
   - เก็บ snapshot ของผังและผลตรวจตอนกดแชร์ — แก้ผังทีหลังลิงก์เดิมไม่เปลี่ยน
   - ผังที่ผลตรวจล่าสุดเป็น blocked → 422 `LAYOUT_BLOCKED`
   - ลิงก์ที่ยัง active ต่อผัง ≤ 20 → เกิน 409 `SHARE_LIMIT_REACHED`
   - `expiresAt` ต้องอยู่ในอนาคตและไม่เกิน 365 วัน; ไม่ส่ง / `null` = ไม่หมดอายุ
   - ยกเลิก = ตั้ง `revokedAt` (**ไม่ลบแถว**) → หน้าแชร์ตอบ 410 `SHARE_REVOKED`; หมดอายุ → 410 `SHARE_EXPIRED`
   - `status` คำนวณตอนตอบ — revoked มาก่อน expired
   - response สาธารณะห้ามมี id เจ้าของ
6. **ขนาด body**: ผัง ≤ 512 KB, ข้อความติดต่อ ≤ 8 KB, อื่น ๆ ≤ 1 KB → 413 `PAYLOAD_TOO_LARGE`
7. **โควตา**: ผังต่อผู้ใช้ ≤ 200 → 409 `LAYOUT_LIMIT_REACHED`
8. **Rate limit ฟอร์มติดต่อ** (เก็บใน Postgres หรือ Redis — ห้ามเก็บในหน่วยความจำ)
   - 5 ครั้ง / 10 นาที ต่อ `X-Client-IP`
   - 5 ครั้ง / 10 นาที ต่อผู้ใช้ที่ล็อกอิน (`sub`)
   - รวมทั้งระบบ 50 ครั้ง / 10 นาที
   - เกิน → 429 `RATE_LIMITED` + header `Retry-After` + `retryAfter` (วินาที) ใน body
   - BFF ตรวจ honeypot และ trim มาแล้ว — Backend ตรวจ schema ซ้ำ และแจ้งเตือนทีมงานเอง
9. **ลบบัญชี** (`DELETE /v1/me`): ลบโปรไฟล์ ผัง ลิงก์แชร์ และข้อความติดต่อของผู้ใช้ถาวร; ผู้ใช้ที่ไม่มีข้อมูลก็ตอบ 204
10. **ย้ายผัง Guest** (`POST /v1/me/merge-guest`)
    - `sub` เป็น Guest เอง → 400
    - ย้ายผังและลิงก์แชร์ทั้งหมด; id ที่ชนกับผังเดิมให้ตั้ง id ใหม่และรายงานใน `renamed`
    - เสร็จแล้วลบบัญชี Guest — เรียกซ้ำด้วย guestId เดิมได้ `movedLayouts: 0`
11. **5xx**: ห้ามแนบ stack trace — BFF ลองซ้ำเฉพาะ GET 1 ครั้ง

## 7. รูปแบบ Error

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "layout not found",
    "details": [{ "path": "layout.width", "message": "..." }],
    "retryAfter": 60,
    "validation": { },
    "issues": [ ]
  }
}
```

`details`, `retryAfter`, `validation`, `issues` ใส่เฉพาะเมื่อเกี่ยวข้อง; `message` สำหรับ log — BFF เลือกข้อความภาษาไทยจาก `code`

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
| `SHARE_LIMIT_REACHED` | 409 | ลิงก์ active ครบ 20 |
| `SHARE_REVOKED` | 410 | ลิงก์ถูกยกเลิก |
| `SHARE_EXPIRED` | 410 | ลิงก์หมดอายุ |
| `RATE_LIMITED` | 429 | ถี่เกิน (แนบ `retryAfter`) |
| `INTERNAL_ERROR` | 5xx | ข้อผิดพลาดภายใน / ไม่พร้อมชั่วคราว (503) |

## 8. Database Schema

ตารางและคอลัมน์มาจากข้อแนะนำในสัญญา (ไม่บังคับ) — **ชนิดข้อมูล, FK และ index ด้านล่างเป็นข้อเสนอ** ปรับได้ตามเหมาะสม
ผังถูกอ่าน/เขียนทั้งฉบับเสมอ → เก็บเป็น `jsonb` ก้อนเดียว ไม่ต้องแตกหลายตาราง

```sql
CREATE TABLE users (
  id          text PRIMARY KEY,                 -- guest-<uuid> | google-123 | line-U...
  provider    text NOT NULL CHECK (provider IN ('guest','google','line','github')),
  name        varchar(200),
  email       varchar(254),
  image       varchar(2048),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE layouts (
  owner_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id          varchar(128) NOT NULL,
  layout      jsonb NOT NULL,                   -- StoreLayout
  validation  jsonb NOT NULL,                   -- ValidationResult (Backend คำนวณเอง)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, id)
);
CREATE INDEX layouts_owner_updated ON layouts (owner_id, updated_at DESC);

CREATE TABLE share_links (
  share_key   char(43) PRIMARY KEY,
  owner_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  layout_id   varchar(128) NOT NULL,
  layout      jsonb NOT NULL,                   -- snapshot ตอนกดแชร์
  validation  jsonb NOT NULL,                   -- snapshot ตอนกดแชร์
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz,                      -- null = ไม่หมดอายุ
  revoked_at  timestamptz                       -- revoke = ตั้งค่านี้ ห้ามลบแถว
);
CREATE INDEX share_links_owner_layout ON share_links (owner_id, layout_id, created_at DESC);

CREATE TABLE contact_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text REFERENCES users(id) ON DELETE CASCADE,  -- null = anonymous
  name        varchar(80)   NOT NULL,
  email       varchar(254)  NOT NULL,
  message     varchar(2000) NOT NULL,
  client_ip   varchar(64),
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rate_limits (
  key          text NOT NULL,                   -- เช่น contact:ip:<ip>, contact:user:<sub>, contact:global
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
```

ข้อควรระวัง:
- **ลบผัง** → ตั้ง `revoked_at` ให้ `share_links` ของผังนั้น (ไม่ลบแถว)
- **ลบบัญชี** → ลบทุกอย่างของผู้ใช้ (CASCADE ช่วยได้)
- **merge-guest** → ย้าย `owner_id` ของ `layouts` และ `share_links` จาก guest ไปผู้ใช้ใหม่ใน transaction เดียว แล้วลบแถว guest ใน `users`
- ถ้าผู้ใช้ยังไม่มีแถวใน `users` (เช่น Guest ที่ยังไม่ถูก `PUT /v1/me`) แต่บันทึกผัง — ต้องเลือกว่าจะสร้าง user อัตโนมัติ หรือไม่ใส่ FK (สัญญาไม่ได้ระบุ)
- `rate_limits` ควรมีงานลบแถวเก่าเป็นระยะ

## 9. ไฟล์ที่ควรใช้ใน repo Backend

| ไฟล์ (repo หน้าเว็บ) | ใช้ทำอะไร |
|---|---|
| `contracts/openapi.yaml` | สัญญาหลัก (OpenAPI 3.1) — ดูแบบหน้าเว็บ: `npx redocly preview-docs contracts/openapi.yaml` |
| `contracts/README.md` | คู่มือสัญญาฉบับเต็ม |
| `contracts/contract-checker.ts` | ห่อ fetch handler ด้วย `contractFetch()` ในเทสต์ แล้วตรวจว่า `violations` ว่าง |
| `mock-backend/handler.ts` | Backend จำลองตามสัญญา (ข้อมูลในหน่วยความจำ) ใช้ดูพฤติกรรมที่คาดไว้ — `/__mock/*` เป็นของเทสต์ ไม่ต้องทำ |

รัน Backend จำลอง:

```bash
npm run mock:build && INTERNAL_TOKEN_SECRET=dev npm run mock:start   # http://localhost:4010
```

### การเปลี่ยนสัญญา

- แก้ `openapi.yaml` ใน repo หน้าเว็บก่อนเสมอ แล้ว `make contract` + `make test` ต้องผ่าน
- เพิ่มฟิลด์ไม่บังคับ / endpoint ใหม่ → เพิ่ม `info.version` ระดับ minor
- เปลี่ยนหรือลบของเดิม (breaking) → ทำ path ใหม่ใต้ `/v2` แล้วค่อยเลิก `/v1` เมื่อทั้งสองฝั่งย้ายเสร็จ

## 10. Checklist ก่อนต่อระบบ (Production Gate ฝั่ง BE)

- [ ] ทำตาม `contracts/openapi.yaml` ครบทุก endpoint (contract test ผ่าน)
- [ ] ตรวจผังซ้ำด้วย `wang-raan-core` ก่อนบันทึก — ผัง Blocked ถูกปฏิเสธ
- [ ] ผู้ใช้เปิด/แก้/ลบผังของคนอื่นไม่ได้
- [ ] ตรวจ internal Bearer token จาก BFF ทุก request
- [ ] Rate limit เก็บที่ที่ใช้ร่วมกันได้ (Postgres หรือ Redis)
- [ ] ลิงก์แชร์ยกเลิกได้ / หมดอายุได้
- [ ] ลบบัญชีแล้วไม่เหลือข้อมูลของผู้ใช้ในฐานข้อมูล
- [ ] Migration เป็นไฟล์ในโค้ด รันอัตโนมัติตอน deploy
- [ ] Backup ทุกคืน → R2 และซ้อมกู้คืนจริงแล้ว (บันทึกเวลาที่ใช้)
- [ ] ตั้ง usage limit บน Railway แล้ว

## 11. เรื่องที่ยังต้องตัดสิน

| คำถาม | กระทบ |
|---|---|
| ยังให้ใช้แบบ Guest ได้ไหม หรือบังคับล็อกอินก่อนบันทึก | merge-guest, การสร้าง user อัตโนมัติ |
| ช่องทางแจ้งเตือนทีมงาน (อีเมล / LINE / Slack) | ฟอร์มติดต่อ |
| ชื่อโดเมนของ Backend | `servers` ใน `openapi.yaml`, `WANGRAAN_BACKEND_URL` |
