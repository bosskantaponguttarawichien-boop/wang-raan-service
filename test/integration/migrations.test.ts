import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { initialSchemaMigration } from '../../src/db/migrations/001-initial-schema.js';
import { identitiesMigration } from '../../src/db/migrations/002-identities.js';

// รัน migration บน schema แยกที่มีแค่ 001 เพื่อทดสอบ backfill กับข้อมูลเดิมจริง ๆ
describe('002-identities migration (PostgreSQL)', () => {
  let pool: Pool;
  let client: PoolClient;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    client = await pool.connect();
  });
  afterAll(async () => {
    client.release();
    await pool.end();
  });

  async function freshSchema(): Promise<void> {
    await client.query('DROP SCHEMA IF EXISTS migration_test CASCADE; CREATE SCHEMA migration_test');
    await client.query('SET search_path TO migration_test, public');
    await initialSchemaMigration.up(client);
  }

  const identities = async () =>
    (
      await client.query(
        'SELECT provider, provider_account_id, user_id, email, email_verified FROM identities ORDER BY user_id',
      )
    ).rows;

  it('backfills one identity per legacy user without merging duplicate emails', async () => {
    await freshSchema();
    await client.query(`
      INSERT INTO users (id, provider, email) VALUES
        ('google-1234', 'google', '  Somchai@Gmail.com '),
        ('line-U9f-x', 'line', 'somchai@gmail.com'),
        ('github-42', 'github', ''),
        ('guest-0f8e2a4c-1b3d-4e5f-8a9b-0c1d2e3f4a5b', 'guest', NULL),
        ('legacy-odd-id', 'google', 'odd@example.com')
    `);

    await identitiesMigration.up(client);

    expect(await identities()).toEqual([
      { provider: 'github', provider_account_id: '42', user_id: 'github-42', email: null, email_verified: false },
      {
        provider: 'google',
        provider_account_id: '1234',
        user_id: 'google-1234',
        email: 'somchai@gmail.com',
        email_verified: false,
      },
      {
        provider: 'line',
        provider_account_id: 'U9f-x',
        user_id: 'line-U9f-x',
        email: 'somchai@gmail.com',
        email_verified: false,
      },
    ]);
    // สัญญา Identity.lastLoginAt ห้ามเป็น null — แถว backfill ใช้ updated_at ของผู้ใช้
    const missing = await client.query('SELECT 1 FROM identities WHERE last_login_at IS NULL');
    expect(missing.rowCount).toBe(0);
  });

  it('accepts the email provider, cascades identities on user delete and rolls back cleanly', async () => {
    await freshSchema();
    await identitiesMigration.up(client);
    await client.query(`INSERT INTO users (id, provider) VALUES ('usr-7b0c', 'email')`);
    await client.query(
      `INSERT INTO identities (provider, provider_account_id, user_id, email, email_verified)
       VALUES ('email', 'a@example.com', 'usr-7b0c', 'a@example.com', true)`,
    );
    await expect(
      client.query(
        `INSERT INTO identities (provider, provider_account_id, user_id, email) VALUES ('email', 'b', 'usr-7b0c', 'B@x.com')`,
      ),
    ).rejects.toThrow(/check constraint/);

    await client.query(`DELETE FROM users WHERE id = 'usr-7b0c'`);
    expect(await identities()).toEqual([]);

    await identitiesMigration.down(client);
    const tables = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'migration_test' AND table_name = 'identities'`,
    );
    expect(tables.rowCount).toBe(0);
    await expect(client.query(`INSERT INTO users (id, provider) VALUES ('usr-x', 'email')`)).rejects.toThrow(
      /check constraint/,
    );
    await client.query('DROP SCHEMA migration_test CASCADE; SET search_path TO public');
  });
});
