#!/bin/sh
# =============================================================================
# วางร้าน — PostgreSQL backup → Cloudflare R2 (S3-compatible)
#
# ต้องมี:  DATABASE_URL, R2_ACCOUNT_ID (หรือ R2_ENDPOINT), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
# เลือกได้: BACKUP_PREFIX (ค่าเริ่มต้น wang-raan), BACKUP_RETENTION_DAYS (ค่าเริ่มต้น 30)
#
# retention สำคัญต่อ PDPA: ข้อมูลที่ผู้ใช้สั่งลบยังอยู่ใน backup จนกว่าไฟล์จะถูกลบตามรอบนี้
# =============================================================================
set -eu

require() {
  eval "value=\${$1:-}"
  if [ -z "$value" ]; then
    echo "backup: missing required environment variable $1" >&2
    exit 64
  fi
}

require DATABASE_URL
require R2_ACCESS_KEY_ID
require R2_SECRET_ACCESS_KEY
require R2_BUCKET
if [ -z "${R2_ENDPOINT:-}" ]; then
  require R2_ACCOUNT_ID
  R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
fi

PREFIX="${BACKUP_PREFIX:-wang-raan}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="${R2_REGION:-auto}"
s3() { aws --endpoint-url "$R2_ENDPOINT" "$@"; }

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
dump="$workdir/wang-raan-$stamp.dump"

echo "backup: dumping database"
pg_dump --format=custom --compress=9 --no-owner --no-privileges --file="$dump" "$DATABASE_URL"

# ตรวจว่าไฟล์อ่านกลับได้จริงก่อนอัปโหลด — dump ที่เสียไม่ควรไปแทนที่ของดีตามรอบ retention
pg_restore --list "$dump" >/dev/null
size="$(wc -c <"$dump" | tr -d ' ')"

key="$PREFIX/$stamp.dump"
echo "backup: uploading s3://$R2_BUCKET/$key ($size bytes)"
s3 s3 cp "$dump" "s3://$R2_BUCKET/$key" --only-show-errors

# ลบไฟล์ที่เก่ากว่า retention — ชื่อไฟล์เป็น timestamp UTC จึงเทียบเป็นสตริงได้
cutoff="$(date -u -d "@$(($(date +%s) - RETENTION_DAYS * 86400))" +%Y%m%dT%H%M%SZ)"
s3 s3 ls "s3://$R2_BUCKET/$PREFIX/" | awk '{print $4}' | while read -r name; do
  case "$name" in
    *.dump)
      if [ "${name%.dump}" \< "$cutoff" ]; then
        echo "backup: removing expired $PREFIX/$name"
        s3 s3 rm "s3://$R2_BUCKET/$PREFIX/$name" --only-show-errors
      fi
      ;;
  esac
done

echo "backup: done ($key)"
