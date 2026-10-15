# AGENTS.md — วางร้าน (Wang-Raan) Service & Harness Operating System

> ไฟล์นี้เป็น context และระเบียบปฏิบัติหลักสำหรับ AI Agent ในการทำงานกับโปรเจกต์ **วางร้าน (Wang-Raan) Backend Service** (`wang-raan-service`)
> ตอบเป็นภาษาไทย เว้นแต่ผู้ใช้จะระบุขอเป็นภาษาอื่น

---

## Startup Workflow & Harness Setup

ก่อนเขียนโค้ดหรือแก้ไขไฟล์ใด ๆ ในแต่ละเทิร์น:
1. **ยืนยัน working directory** ด้วย `pwd` (ต้องอยู่ที่ root ของ repo `wang-raan-service`)
2. **อ่านไฟล์นี้ (`AGENTS.md`)** ให้เข้าใจขอบเขตและกฎสำคัญ
3. **อ่าน context หลักของระบบ**:
   - `BACKEND_HANDOFF.md` — ข้อกำหนดการเชื่อมต่อกับ BFF, Internal Token, Endpoints และข้อตกลง
   - `architecture.md` — สถาปัตยกรรม Backend, Database Schema (PostgreSQL DDL), Rate Limiter, และ Validation Pipeline
   - `PRD.md` — ฟังก์ชัน, ข้อมูลร้าน, กฎการออกแบบ และ PDPA
   - `contracts/openapi.yaml` (v1.3.0) — สัญญา API มาตรฐาน Single Source of Truth
   - `SKILL.md` — กฎเหล็กและเช็กลิสต์การพัฒนา Backend
4. **รัน `./harness/init.sh`** เพื่อตรวจว่า workspace, dependencies, และ Architectural Boundaries พร้อม
5. **อ่าน `harness/feature_list.json`** เพื่อเลือกงานที่ active และดู dependencies / gates / priorities
6. **อ่าน `harness/progress.md`** เพื่อดูงานที่ทำเสร็จแล้ว งานค้าง และบันทึกจากเซสชันก่อนหน้า

---

## Working Rules (Harness Workflow)

- **One Feature at a Time**: เลือกงานที่มี `"status": "not-started"` หรือ `"in-progress"` ใน `harness/feature_list.json` ที่ไม่มี dependency ค้างอยู่ ครั้งละ 1 งานเท่านั้น
- **Gate ต้องผ่านก่อน**: งานที่มีเงื่อนไข `gate` ต้องผ่านเกณฑ์ก่อนเริ่มงานเสมอ
- **Task Decomposition**: ทุกงานที่มีความซับซ้อน (>3 steps หรือเกี่ยวข้องกับ Database Transaction / Auth / Validation) ต้องเขียนแผนในบทสนทนาก่อนลงมือเสมอ:
  ```
  GOAL: <เป้าหมายที่แท้จริงของงานนี้>
  DONE-WHEN: <เกณฑ์เสร็จสมบูรณ์ที่ตรวจสอบได้จริงเป็นรูปธรรม 2-5 ข้อ>
  PLAN:
    1. <ขั้นตอนการทำงาน> — verify โดย: <จะรู้ได้อย่างไรว่าขั้นตอนนี้ผ่าน>
  RISKS: <จุดที่อาจผิดพลาดได้ง่าย หรือเคสที่อาจพัง>
  ```
- **Stay in Scope**: แก้เฉพาะไฟล์ที่เกี่ยวข้องกับขอบเขตงานที่กำลังทำ ห้ามแตะไฟล์นอกเรื่อง
- **Verification Gate**: ต้อง verify ด้วย `make test`, `make lint`, และ `make contract` ให้ผ่าน 100% ก่อนอ้างว่างานเสร็จ
- **State Updates**: เมื่องานเสร็จ ให้อัปเดต status ใน `harness/feature_list.json` เป็น `"done"` พร้อมใส่ `"evidence"` และบันทึกสรุปงานลง `harness/progress.md` ตามรูปแบบที่กำหนด
- **Session Lifecycle**: ก่อนจบเทิร์นหรือส่งต่องาน ต้องอัปเดต `harness/session-handoff.md` เสมอ

---

## ภาพรวมระบบ (System Overview)

`wang-raan-service` เป็น Backend API สำหรับระบบ **วางร้าน (Wang-Raan)** ทำหน้าที่เป็น Core Business Logic, Validation Engine และ Persistence Layer ให้บริการแก่ Next.js BFF (Backend-for-Frontend บน Cloudflare Workers) โดยไคลเอนต์ไม่สามารถเรียกเข้ามาตรง ๆ ได้

```
เบราว์เซอร์ ──cookie──▶ BFF (Next.js บน Cloudflare Workers) ──Bearer JWT──▶ Backend (Fastify บน Railway) ──▶ PostgreSQL
```

---

## หลักการสำคัญ (อย่าละเมิด — Inviolable Principles)

| หลักการ | รายละเอียดที่ห้ามละเมิด |
|---|---|
| **Zero-Trust Internal JWT** | ทุกคำขอ (ยกเว้น `GET /health`) ต้องมี `Authorization: Bearer <token>`, ตรวจสอบด้วย HS256 ผ่าน `INTERNAL_TOKEN_SECRET`, ตรวจ `iss === "wang-raan-bff"`, `aud === "wang-raan-backend"`, อายุ ≤ 300 วินาที |
| **User ID จาก Token เท่านั้น** | **ห้ามอ่าน User ID จาก Request Body หรือ Query Parameter เด็ดขาด** ให้ผูกกับ `sub` จาก Token เสมอ |
| **Anonymous Scope Restriction** | `sub === "anonymous"` อนุญาตเฉพาะ endpoint ที่มี `x-allow-anonymous: true` (`GET /v1/public/shares/:shareKey`, `POST /v1/contact-messages`, `POST /v1/auth/identities/resolve`, `POST /v1/auth/otp/request`, `POST /v1/auth/otp/verify`) — Route อื่นทั้งหมดต้องตอบ **`401 UNAUTHORIZED`** |
| **Backend ออก User ID** | บัญชีเกิดจาก `resolve` / `otp/verify` เท่านั้น (`usr-<uuid>`, `guest-<uuid>`; ผู้ใช้เดิม `<provider>-<id>` คง id เดิม) — ผูกบัญชีด้วยอีเมลเฉพาะเมื่อยืนยันแล้วทั้งสองฝั่ง (google/email) · ห้ามตีความ prefix ของ `sub` เป็น provider |
| **Multi-Tenant 404 Protection** | ทรัพยากรที่เป็นของผู้อื่น หรือไม่มีอยู่จริง ต้องส่งกลับ **`404 NOT_FOUND`** เสมอ (**ห้ามส่ง 403 FORBIDDEN** เพื่อไม่เปิดเผยว่ามี ID นั้นอยู่ในระบบ) |
| **Dual-Tier Layout Validation** | ก่อนบันทึกผังร้านลง DB ต้อง parse ด้วย Zod และตรวจสอบด้วย `validateLayout()` จาก `@bosskantaponguttarawichien-boop/wang-raan-core` หากสถานะเป็น `blocked` ต้องตอบ **`422 LAYOUT_BLOCKED`** และห้ามบันทึกเด็ดขาด |
| **100% OpenAPI Compliance** | ทุก Endpoint, Request, Response, Status Code และ Error Format ต้องตรงตาม [`contracts/openapi.yaml`](contracts/openapi.yaml) v1.3.0 อย่างสมบูรณ์ |
| **Atomic Database Transactions** | การดำเนินการที่กระทบหลายตาราง (Merge Guest, Delete Layout + Revoke Share Links, Delete User Cascade) ต้องทำภายใต้ Database Transaction เสมอ |
| **Database-backed Rate Limiter** | การจำกัดอัตราเรียกสำหรับ `POST /v1/contact-messages` ต้องใช้ Fixed Window บน PostgreSQL ทั้ง 3 มิติ (IP, User, Global) |
| **Pure Backend (No UI/DOM)** | โค้ดทั้งหมดใน `src/` ต้องเป็น Pure Node.js/TypeScript **ห้าม import React, Zustand, DOM, หรือ Next.js เด็ดขาด** |

---

## สถาปัตยกรรมซอร์สโค้ด (Directory Structure)

```
wang-raan-service/
├── harness/                    # ← Agent Harness Ecosystem
│   ├── init.sh                 # Environment initialization & boundary check
│   ├── feature_list.json       # Master feature task tracking (Single source of truth)
│   ├── feature_list.archive.json # Archive ของ feature ที่เสร็จสิ้น
│   ├── progress.md             # Worklog บันทึกความคืบหน้าของแต่ละ session
│   ├── session-handoff.md      # เอกสารส่งต่องานระหว่างเซสชัน
│   ├── sprint-1.md             # รายละเอียด Sprint 1
│   └── archive/                # เอกสารเก่าที่ archive ไว้
├── scripts/                    # ← เครื่องมือสนับสนุน Harness
│   ├── harness_state.py        # ตัวโหลด state และ merge archive
│   └── validate_harness.py     # ตัวตรวจจับ Schema, Broken/Cyclic Deps
├── contracts/                  # ← สัญญา API ระหว่าง BFF กับ Backend
│   ├── openapi.yaml            # OpenAPI Spec 3.1.0 (v1.3.0)
│   └── redocly.yaml            # Redocly lint configuration
├── src/
│   ├── config/                 # Environment variables & runtime validation (Zod)
│   ├── db/                     # PostgreSQL client pool & migrations
│   ├── middleware/             # Auth (JWT HS256), Tracing (X-Request-Id), Error Handler
│   ├── modules/                # Domain Modules: health, layouts, shares, users, contact
│   ├── services/               # Core validator, token parser, share key generator, notifier
│   ├── types/                  # TypeScript contract interfaces
│   └── app.ts                  # Fastify application bootstrap
├── Makefile                    # รวมคำสั่งลัดประจำโปรเจกต์
├── PRD.md                      # Product Requirements Document
├── architecture.md             # System Architecture Document
├── BACKEND_HANDOFF.md          # Backend Interface Guidelines
├── SKILL.md                    # Core Developer Rules & Checklist
└── AGENTS.md                   # คู่มือปฏิบัติการของ Agent (ไฟล์นี้)
```

---

## คำสั่งประจำ (Makefile Commands)

```bash
make help        # แสดงคำสั่งทั้งหมด
make init        # รัน ./harness/init.sh ตรวจสอบระบบและ boundaries
make status      # ตรวจสอบความถูกต้องของ Feature List ใน Harness
make test        # รัน Unit Tests ทั้งหมด
make lint        # ตรวจสอบ Architectural Boundaries และ Linting
make contract    # ตรวจสอบความถูกต้องของสัญญา API (OpenAPI)
make dev         # เริ่มต้น Fastify Development Server
make build       # คอมไพล์ TypeScript สำหรับ Production
make docker-up   # เริ่มต้น Local PostgreSQL ผ่าน Docker Compose
make docker-down # หยุดการทำงานของ Local Docker Compose
```
