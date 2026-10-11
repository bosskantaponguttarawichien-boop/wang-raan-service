import { buildApp } from './app.js';
import { createDatabasePool } from './db/client.js';

const port = Number.parseInt(process.env.PORT ?? '4000', 10);
const host = process.env.HOST ?? '0.0.0.0';
const database = createDatabasePool();
const app = buildApp({ database });
// client ที่ idle อาจ error ตอนฐานข้อมูลรีสตาร์ต — ถ้าไม่ดัก pool จะโยน error จนทั้ง process ล่ม
database.on('error', (error) => app.log.warn({ err: error }, 'idle PostgreSQL client error'));
app.addHook('onClose', async () => {
  await database.end();
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, 'shutting down server');
  await app.close();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error, 'failed to start server');
  process.exitCode = 1;
}
