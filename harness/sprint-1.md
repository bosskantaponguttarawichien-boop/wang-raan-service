# Sprint 1 — Backend Infrastructure & Foundation

> เริ่ม 2026-10-10 · งานทั้งหมดอยู่ใน `harness/feature_list.json` (ฟิลด์ `"sprint": 1`)

## เป้าหมาย

วางรากฐานทางวิศวกรรมของ `wang-raan-service` ให้พร้อมสำหรับต่อกับ BFF (Next.js บน Cloudflare Workers)
ตามสัญญา [`contracts/openapi.yaml`](../contracts/openapi.yaml) (v1.1.0) และ [`BACKEND_HANDOFF.md`](../BACKEND_HANDOFF.md)

## ขอบเขตงานใน Sprint 1

| Task ID | ชื่องาน | บทบาท | ผลลัพธ์ที่คาดหวัง |
|---|---|---|---|
| `feat-000` | Harness & Agent Operating System Setup | `core` | โครงสร้าง Harness, `init.sh`, `validate_harness.py`, `AGENTS.md`, `Makefile` |
| `feat-001` | Project Foundation, Fastify Bootstrap & Tooling | `core` | `package.json`, TypeScript, Fastify, Vitest, ESLint, `.env.example` |
| `feat-002` | Core Package & Contract Integration | `core` | ติดตั้ง `@bosskantaponguttarawichien-boop/wang-raan-core`, Zod, Redocly lint |
| `feat-003` | Database Infrastructure & Migrations Architecture | `db` | PostgreSQL pool, Migration runner, DDL 5 ตารางหลัก (`users`, `layouts`, `share_links`, `contact_messages`, `rate_limits`) |
| `feat-004` | Security, Auth & Tracing Middleware | `auth` | Internal JWT (HS256) verification, `X-Request-Id`, `X-Client-IP`, Payload Limiter, Uniform Error Handler |
| `feat-005` | Health Check API (GET /health) | `api` | Endpoint ทดสอบการทำงานของ Fastify Server และสถานะการเชื่อมต่อ PostgreSQL |

## สแตกเทคโนโลยี

- **Runtime:** Node.js 20 LTS (TypeScript Strict, Native ESM)
- **Framework:** Fastify (เน้น High Performance, Schema Validation, Structured Logging)
- **Database:** PostgreSQL (Railway Singapore)
- **Crypto & Auth:** `jose` (HS256 verification)
- **Domain Rules:** `@bosskantaponguttarawichien-boop/wang-raan-core` + Zod
- **Testing:** Vitest
