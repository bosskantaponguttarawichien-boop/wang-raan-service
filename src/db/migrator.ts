import type { Pool, PoolClient } from 'pg';
import { migrations } from './migrations/index.js';
import type { Migration } from './migrations/index.js';

const MIGRATION_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());';
const MIGRATION_LOCK_ID = 7_211_006;

async function begin(client: PoolClient): Promise<void> {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_ID]);
  await client.query(MIGRATION_TABLE_SQL);
}

function byId(id: string): Migration {
  const migration = migrations.find((candidate) => candidate.id === id);
  if (!migration) throw new Error(`Migration ${id} is recorded in the database but unavailable in this build`);
  return migration;
}

/** Applies every unapplied migration in one advisory-locked transaction. */
export async function migrate(pool: Pool): Promise<string[]> {
  const client = await pool.connect();
  try {
    await begin(client);
    const recorded = await client.query<{ id: string }>('SELECT id FROM schema_migrations');
    const appliedIds = new Set(recorded.rows.map((row) => row.id));
    const pending = migrations.filter((migration) => !appliedIds.has(migration.id));
    for (const migration of pending) {
      await migration.up(client);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
    }
    await client.query('COMMIT');
    return pending.map((migration) => migration.id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Reverses only the latest migration, keeping rollback explicit and recoverable. */
export async function rollbackLatestMigration(pool: Pool): Promise<string | undefined> {
  const client = await pool.connect();
  try {
    await begin(client);
    const result = await client.query<{ id: string }>(
      'SELECT id FROM schema_migrations ORDER BY applied_at DESC, id DESC LIMIT 1',
    );
    const latest = result.rows[0];
    if (!latest) {
      await client.query('COMMIT');
      return undefined;
    }
    const migration = byId(latest.id);
    await migration.down(client);
    await client.query('DELETE FROM schema_migrations WHERE id = $1', [migration.id]);
    await client.query('COMMIT');
    return migration.id;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
