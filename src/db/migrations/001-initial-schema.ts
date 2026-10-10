import type { PoolClient } from 'pg';
import type { Migration } from './types.js';

export const INITIAL_SCHEMA_UP_SQL = `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE TABLE IF NOT EXISTS users (
    id text PRIMARY KEY,
    provider text NOT NULL CHECK (provider IN ('guest', 'google', 'line', 'github')),
    name varchar(200), email varchar(254), image varchar(2048),
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS layouts (
    owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id varchar(128) NOT NULL, layout jsonb NOT NULL, validation jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, id)
  );
  CREATE INDEX IF NOT EXISTS layouts_owner_updated ON layouts (owner_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS share_links (
    share_key char(43) PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    layout_id varchar(128) NOT NULL, layout jsonb NOT NULL, validation jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz, revoked_at timestamptz
  );
  CREATE INDEX IF NOT EXISTS share_links_owner_layout ON share_links (owner_id, layout_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS contact_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text REFERENCES users(id) ON DELETE CASCADE,
    name varchar(80) NOT NULL, email varchar(254) NOT NULL, message varchar(2000) NOT NULL,
    client_ip varchar(64), received_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS rate_limits (
    key text NOT NULL, window_start timestamptz NOT NULL, count integer NOT NULL DEFAULT 0,
    PRIMARY KEY (key, window_start)
  );
`;

export const INITIAL_SCHEMA_DOWN_SQL = `
  DROP TABLE IF EXISTS rate_limits;
  DROP TABLE IF EXISTS contact_messages;
  DROP TABLE IF EXISTS share_links;
  DROP TABLE IF EXISTS layouts;
  DROP TABLE IF EXISTS users;
`;

export const initialSchemaMigration: Migration = {
  id: '001-initial-schema',
  async up(client: PoolClient): Promise<void> {
    await client.query(INITIAL_SCHEMA_UP_SQL);
  },
  async down(client: PoolClient): Promise<void> {
    await client.query(INITIAL_SCHEMA_DOWN_SQL);
  },
};
