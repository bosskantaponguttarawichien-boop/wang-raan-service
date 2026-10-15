import { Pool } from 'pg';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../../src/app.js';
import type { BuildAppOptions } from '../../src/app.js';
import { signToken, TEST_CONFIG } from '../helpers/token.js';

export interface TestContext {
  app: FastifyInstance;
  pool: Pool;
  /** ยิงคำขอในนามผู้ใช้ `sub` แบบเดียวกับที่ BFF ทำ */
  as(sub: string, options: InjectOptions): Promise<LightMyRequestResponse>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createTestContext(
  options: Omit<BuildAppOptions, 'database' | 'config'> = {},
): Promise<TestContext> {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const app = buildApp({ config: TEST_CONFIG, database: pool, ...options });
  await app.ready();

  return {
    app,
    pool,
    async as(sub, request) {
      const token = await signToken({ sub });
      return app.inject({
        ...request,
        headers: {
          authorization: `Bearer ${token}`,
          'x-request-id': crypto.randomUUID(),
          ...request.headers,
        },
      });
    },
    async reset() {
      await pool.query(
        'TRUNCATE users, identities, layouts, share_links, contact_messages, rate_limits, otp_codes CASCADE',
      );
    },
    async close() {
      await app.close();
      await pool.end();
    },
  };
}
