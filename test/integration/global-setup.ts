import { Pool } from 'pg';
import { migrate } from '../../src/db/migrator.js';

export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is required — run through `npm run test:integration`');
  const pool = new Pool({ connectionString: url });
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
}
