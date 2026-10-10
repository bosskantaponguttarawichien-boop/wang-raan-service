import { createDatabasePool } from './client.js';
import { migrate, rollbackLatestMigration } from './migrator.js';

const command = process.argv[2] ?? 'up';
const pool = createDatabasePool();
try {
  if (command === 'up') console.info(`Applied migrations: ${(await migrate(pool)).join(', ') || 'none'}`);
  else if (command === 'down')
    console.info(`Rolled back migration: ${(await rollbackLatestMigration(pool)) ?? 'none'}`);
  else throw new Error(`Unknown migration command: ${command}`);
} finally {
  await pool.end();
}
