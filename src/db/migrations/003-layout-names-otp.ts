import type { PoolClient } from 'pg';
import type { Migration } from './types.js';

/**
 * สัญญา v1.3.0
 * - `layouts.name`: ชื่อผัง 1–80 ตัว (นับ code point — ตรวจที่ service) ผังเดิมได้ "ผังร้าน {กว้าง} × {ลึก} ม."
 *   (ข้อความ width/depth มาจาก JSON ของผังตรง ๆ จึงตรงกับที่ FE ตั้งให้ผังใหม่)
 * - `otp_codes`: รหัส OTP ล่าสุดต่ออีเมล — เก็บแค่ hash ทั้งอีเมลและรหัส (ห้ามเก็บรหัสจริง)
 *   ขอใหม่ = เขียนทับแถวเดิม รหัสเก่าจึงใช้ไม่ได้ทันที
 */
export const LAYOUT_NAMES_OTP_UP_SQL = `
  ALTER TABLE layouts ADD COLUMN IF NOT EXISTS name varchar(80);
  UPDATE layouts SET name = 'ผังร้าน ' || (layout->>'width') || ' × ' || (layout->>'depth') || ' ม.' WHERE name IS NULL;
  ALTER TABLE layouts ALTER COLUMN name SET NOT NULL;
  ALTER TABLE layouts ADD CONSTRAINT layouts_name_not_blank CHECK (btrim(name) <> '');
  CREATE TABLE IF NOT EXISTS otp_codes (
    email_hash char(64) PRIMARY KEY,
    code_hash char(64) NOT NULL,
    expires_at timestamptz NOT NULL,
    attempts_left smallint NOT NULL CHECK (attempts_left >= 0),
    last_requested_at timestamptz NOT NULL
  );
  CREATE INDEX IF NOT EXISTS otp_codes_expires ON otp_codes (expires_at);
`;

export const LAYOUT_NAMES_OTP_DOWN_SQL = `
  DROP TABLE IF EXISTS otp_codes;
  ALTER TABLE layouts DROP CONSTRAINT IF EXISTS layouts_name_not_blank;
  ALTER TABLE layouts DROP COLUMN IF EXISTS name;
`;

export const layoutNamesOtpMigration: Migration = {
  id: '003-layout-names-otp',
  async up(client: PoolClient): Promise<void> {
    await client.query(LAYOUT_NAMES_OTP_UP_SQL);
  },
  async down(client: PoolClient): Promise<void> {
    await client.query(LAYOUT_NAMES_OTP_DOWN_SQL);
  },
};
