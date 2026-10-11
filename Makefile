# =============================================================================
# วางร้าน (Wang-Raan) Service — Makefile
# รัน: make <target>
# =============================================================================
PYTHON  := python3

.PHONY: help init test lint status dev build contract docker-up docker-down

help:           ## แสดงคำสั่ง (targets) ทั้งหมด
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-14s %s\n", $$1, $$2}'

init:           ## ตรวจสอบสภาพแวดล้อมและรัน Harness Initialization
	@./harness/init.sh

status:         ## ตรวจสอบความถูกต้องของ Feature List ใน Harness
	@$(PYTHON) scripts/validate_harness.py

test:           ## รัน Unit Tests และ Integration Tests (PostgreSQL ผ่าน Docker หรือ TEST_DATABASE_URL)
	@npm test
	@npm run --silent test:integration

lint:           ## ตรวจสอบ Architectural Boundaries และ Linting
	@./harness/init.sh --check-env-only
	@if [ -d src ]; then \
	  if grep -rEn "(import|from)\s+['\"](react|react-dom|zustand|next|@radix-ui)(/[^'\"]*)?['\"]" src/ 2>/dev/null; then \
	    echo "❌ ERROR: พบ import UI/React ใน src/"; exit 1; \
	  else \
	    echo "✅ Boundary OK: src/ เป็น Pure Node.js/Backend"; \
	  fi \
	fi
	@if [ -f package.json ]; then npm run --silent lint && npm run --silent typecheck && echo "✅ ESLint + TypeScript ผ่าน"; fi
	@$(MAKE) --no-print-directory contract

contract:       ## ตรวจสอบรูปแบบสัญญา API (contracts/openapi.yaml) ด้วย Redocly
	@if [ -f contracts/openapi.yaml ]; then \
	  npx -y @redocly/cli lint contracts/openapi.yaml --config contracts/redocly.yaml --format=summary >/dev/null 2>&1 \
	    && echo "✅ สัญญา API (contracts/openapi.yaml) ผ่าน" \
	    || npx -y @redocly/cli lint contracts/openapi.yaml --config contracts/redocly.yaml; \
	fi

dev:            ## เริ่มต้น Development Server
	@if [ -f package.json ]; then npm run dev; else echo "ยังไม่มี package.json กรุณารัน feat-001 ก่อน"; fi

build:          ## สร้าง Production Bundle
	@if [ -f package.json ]; then npm run build; else echo "ยังไม่มี package.json กรุณารัน feat-001 ก่อน"; fi

docker-up:      ## เริ่มรัน Local PostgreSQL ผ่าน Docker Compose
	@docker compose up -d

docker-down:    ## หยุดการทำงานของ Local Docker Compose
	@docker compose down
