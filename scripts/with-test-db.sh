#!/usr/bin/env bash
# รันคำสั่งพร้อม PostgreSQL สำหรับ integration test
# - ถ้ามี TEST_DATABASE_URL อยู่แล้วใช้ค่านั้น
# - ไม่งั้นเปิด postgres:16-alpine ชั่วคราวผ่าน Docker แล้วลบทิ้งเมื่อจบ
set -euo pipefail

if [[ -n "${TEST_DATABASE_URL:-}" ]]; then
  exec "$@"
fi

if ! docker info >/dev/null 2>&1; then
  echo "❌ integration tests ต้องใช้ Docker (หรือกำหนด TEST_DATABASE_URL)" >&2
  exit 1
fi

name="wang-raan-test-pg-$$"
docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=wang_raan_test \
  -p 127.0.0.1::5432 postgres:16-alpine >/dev/null
trap 'docker stop "$name" >/dev/null 2>&1 || true' EXIT

for _ in $(seq 1 60); do
  # pg_isready ผ่านก่อน init script เสร็จได้ จึงลอง query จริงผ่าน TCP
  if docker exec "$name" psql -h 127.0.0.1 -U postgres -d wang_raan_test -c 'SELECT 1' >/dev/null 2>&1; then break; fi
  sleep 0.5
done

port="$(docker port "$name" 5432/tcp | head -n1 | sed 's/.*://')"
export TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${port}/wang_raan_test"
"$@"
