import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import {
  INITIAL_SCHEMA_DOWN_SQL,
  INITIAL_SCHEMA_UP_SQL,
  initialSchemaMigration,
} from '../src/db/migrations/001-initial-schema.js';
import { migrations } from '../src/db/migrations/index.js';

describe('database migrations', () => {
  it('has unique, ordered migration identifiers', () => {
    const ids = migrations.map((migration) => migration.id);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('creates all domain tables and required indexes', async () => {
    const queries: string[] = [];
    const client = {
      query: async (query: string) => {
        queries.push(query);
        return { rows: [] };
      },
    } as unknown as PoolClient;
    await initialSchemaMigration.up(client);
    expect(queries).toEqual([INITIAL_SCHEMA_UP_SQL]);
    for (const table of ['users', 'layouts', 'share_links', 'contact_messages', 'rate_limits']) {
      expect(INITIAL_SCHEMA_UP_SQL).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(INITIAL_SCHEMA_UP_SQL).toContain('layouts_owner_updated');
    expect(INITIAL_SCHEMA_UP_SQL).toContain('share_links_owner_layout');
  });

  it('drops schema tables in dependency-safe order', async () => {
    const queries: string[] = [];
    const client = {
      query: async (query: string) => {
        queries.push(query);
        return { rows: [] };
      },
    } as unknown as PoolClient;
    await initialSchemaMigration.down(client);
    expect(queries).toEqual([INITIAL_SCHEMA_DOWN_SQL]);
    expect(INITIAL_SCHEMA_DOWN_SQL.indexOf('layouts')).toBeLessThan(INITIAL_SCHEMA_DOWN_SQL.indexOf('users'));
  });
});
