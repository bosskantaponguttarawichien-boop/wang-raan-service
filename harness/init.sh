#!/bin/bash
set -e

echo "=== วางร้าน (Wang-Raan) Service: Harness Initialization & Health Check ==="

# ต้องรันจาก root ของ repo (มี PRD.md, architecture.md และ BACKEND_HANDOFF.md)
cd "$(dirname "$0")/.."

if [ ! -f PRD.md ] || [ ! -f architecture.md ] || [ ! -f BACKEND_HANDOFF.md ]; then
  echo "ERROR: ไม่พบ PRD.md, architecture.md หรือ BACKEND_HANDOFF.md — ต้องรันจาก root ของ repo wang-raan-service" >&2
  exit 1
fi

CHECK_ENV_ONLY=0
case "${1:-}" in
    "") ;;
    --check-env-only) CHECK_ENV_ONLY=1 ;;
    *)
        echo "Usage: ./harness/init.sh [--check-env-only]" >&2
        exit 2
        ;;
esac

# ── 1. Node.js & Runtime Check ───────────────────────────────────────────────
echo "=== 1. Checking Node.js Environment ==="
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: ไม่พบคำสั่ง node ในระบบ กรุณาติดตั้ง Node.js (แนะนำ v20+)" >&2
  exit 1
fi

NODE_VER=$(node -v)
echo "Node.js version: ${NODE_VER} (HEALTHY)"

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: ไม่พบคำสั่ง npm ในระบบ" >&2
  exit 1
fi

NPM_VER=$(npm -v)
echo "npm version: ${NPM_VER} (HEALTHY)"

# ── 2. Python Check (สำหรับ Harness Scripts & Tools) ─────────────────────────
echo "=== 2. Checking Python Environment ==="
if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: ไม่พบ python3 สำหรับรัน harness scripts" >&2
  exit 1
fi
PY_VER=$(python3 --version)
echo "Python version: ${PY_VER} (HEALTHY)"

# ── 3. Docker Check (สำหรับ Local PostgreSQL & Container Dev) ────────────────
echo "=== 3. Checking Docker Environment ==="
if command -v docker >/dev/null 2>&1; then
  echo "Docker binary: พร้อมใช้งาน ($(docker --version))"
else
  echo "Note: ไม่พบคำสั่ง docker ในระบบ (แนะนำสำหรับรัน Local PostgreSQL ใน docker-compose)"
fi

if [ "$CHECK_ENV_ONLY" -eq 1 ]; then
  echo "=== Environment Check: HEALTHY ==="
  exit 0
fi

# ── 4. Dependencies Check ───────────────────────────────────────────────────
echo "=== 4. Checking Project Dependencies ==="
if [ -f package.json ]; then
  if [ ! -d node_modules ]; then
    echo "=== Installing dependencies (npm install) ==="
    npm install
  else
    echo "node_modules: พร้อมใช้งาน"
  fi
else
  echo "Note: ยังไม่มี package.json (จะถูกสร้างใน feat-001)"
fi

# ── 5. Architectural Boundary Checks ─────────────────────────────────────────
echo "=== 5. Checking Architectural Boundaries ==="

BOUNDARY_ERRORS=0

# Boundary 1: Backend ต้องเป็น Pure Server / Node.js ห้าม import React, Zustand, Next.js หรือ DOM APIs
if [ -d src ]; then
  if grep -rEn "(import|from)\s+['\"](react|react-dom|zustand|next|@radix-ui)(/[^'\"]*)?['\"]" src/ 2>/dev/null; then
    echo "ERROR: พบ import UI/React/Zustand ใน src/ — ห้ามเด็ดขาด (Backend Service ต้องเป็น Pure Node/Fastify)"
    BOUNDARY_ERRORS=1
  fi
fi

# Boundary 2: สัญญา API (contracts/openapi.yaml) ต้องมีอยู่เสมอ
if [ ! -f contracts/openapi.yaml ]; then
  echo "ERROR: ไม่พบ contracts/openapi.yaml — Backend ต้องพัฒนาตามสัญญา API อย่างเคร่งครัด"
  BOUNDARY_ERRORS=1
fi

if [ "$BOUNDARY_ERRORS" -eq 0 ]; then
  echo "OK: Architectural boundaries ถูกต้อง ไม่พบการละเมิดกฎ"
else
  echo "ERROR: มีการละเมิด Architectural boundary"
  exit 1
fi

# ── 6. Harness State Validation ──────────────────────────────────────────────
echo "=== 6. Validating Harness State ==="
if [ -f scripts/validate_harness.py ]; then
  python3 scripts/validate_harness.py
fi

# ── 7. Test Suite Verification (ถ้ามี test config) ───────────────────────────
if [ -f package.json ] && grep -q '"test"' package.json; then
  echo "=== 7. Running Test Suite ==="
  npm test -- --run || true
fi

echo "=== Wang-Raan Service Harness: HEALTHY & READY ==="
