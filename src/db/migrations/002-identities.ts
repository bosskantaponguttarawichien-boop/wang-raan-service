import type { PoolClient } from 'pg';
import type { Migration } from './types.js';

/**
 * วิธี login ที่ผูกกับบัญชี — Backend เป็นผู้ออก user id และหาบัญชีจาก `(provider, provider_account_id)`
 * - `email` เก็บแบบ normalize แล้ว (trim + ตัวพิมพ์เล็ก) ใช้ผูกบัญชีเฉพาะแถวที่ `email_verified`
 * - backfill: ผู้ใช้เดิมที่ id เป็น `<provider>-<providerAccountId>` ได้แถวของตัวเองคนละแถว ไม่รวมบัญชีที่อีเมลซ้ำ
 *   และตั้ง `email_verified = false` เพราะไม่รู้ว่าเคยยืนยันหรือไม่ — Guest ไม่มี identity
 * - `last_login_at` NOT NULL ตามสัญญา (`Identity.lastLoginAt` เป็น DateTime เสมอ) — แถว backfill ใช้ `users.updated_at`
 */
export const IDENTITIES_UP_SQL = `
  ALTER TABLE users DROP CONSTRAINT users_provider_check;
  ALTER TABLE users ADD CONSTRAINT users_provider_check
    CHECK (provider IN ('guest', 'google', 'line', 'github', 'email'));
  CREATE TABLE IF NOT EXISTS identities (
    provider text NOT NULL CHECK (provider IN ('google', 'line', 'github', 'email')),
    provider_account_id varchar(255) NOT NULL CHECK (provider_account_id <> ''),
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email varchar(254) CHECK (email = lower(btrim(email)) AND email <> ''),
    email_verified boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(), last_login_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, provider_account_id)
  );
  CREATE INDEX IF NOT EXISTS identities_user ON identities (user_id);
  CREATE INDEX IF NOT EXISTS identities_verified_email ON identities (email) WHERE email_verified;
  INSERT INTO identities (provider, provider_account_id, user_id, email, email_verified, created_at, last_login_at)
  SELECT provider, substr(id, length(provider) + 2), id, NULLIF(lower(btrim(email)), ''), false, created_at, updated_at
  FROM users
  WHERE provider <> 'guest' AND left(id, length(provider) + 1) = provider || '-'
    AND length(id) > length(provider) + 1 AND length(id) - length(provider) - 1 <= 255
  ON CONFLICT DO NOTHING;
`;

/** ถ้ามีผู้ใช้ provider `email` อยู่แล้ว การคืน CHECK เดิมจะล้มและ rollback ทั้งหมด — ไม่ลบบัญชีให้เงียบ ๆ */
export const IDENTITIES_DOWN_SQL = `
  DROP TABLE IF EXISTS identities;
  ALTER TABLE users DROP CONSTRAINT users_provider_check;
  ALTER TABLE users ADD CONSTRAINT users_provider_check
    CHECK (provider IN ('guest', 'google', 'line', 'github'));
`;

export const identitiesMigration: Migration = {
  id: '002-identities',
  async up(client: PoolClient): Promise<void> {
    await client.query(IDENTITIES_UP_SQL);
  },
  async down(client: PoolClient): Promise<void> {
    await client.query(IDENTITIES_DOWN_SQL);
  },
};
