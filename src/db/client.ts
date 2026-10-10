import { Pool } from 'pg';

const DEFAULT_POOL_SIZE = 10;

export function databaseUrlFromEnvironment(): string {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to connect to PostgreSQL');
  }

  return databaseUrl;
}

/** Creates the shared PostgreSQL pool. The caller owns and must close the pool. */
export function createDatabasePool(databaseUrl = databaseUrlFromEnvironment()): Pool {
  return new Pool({ connectionString: databaseUrl, max: DEFAULT_POOL_SIZE });
}
