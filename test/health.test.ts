import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { probeDatabase } from '../src/modules/health/health.service.js';
import type { DatabaseProbeTarget } from '../src/modules/health/health.service.js';
import { TEST_CONFIG } from './helpers/token.js';

function fakeDatabase(query: () => Promise<unknown>): DatabaseProbeTarget {
  return { query: vi.fn(query) } as unknown as DatabaseProbeTarget;
}

describe('GET /health', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function getHealth(database?: DatabaseProbeTarget) {
    app = buildApp({ config: TEST_CONFIG, ...(database ? { database } : {}) });
    return app.inject({ url: '/health' });
  }

  it('returns 200 ok without an Authorization header when the database answers', async () => {
    const database = fakeDatabase(async () => ({ rows: [{ '?column?': 1 }] }));
    const response = await getHealth(database);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', version: '9.9.9-test', database: 'ok' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(database.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('returns 503 degraded when the database query fails, without leaking the error', async () => {
    const response = await getHealth(
      fakeDatabase(async () => {
        throw new Error('connect ECONNREFUSED postgres://admin:hunter2@db:5432');
      }),
    );

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'degraded', version: '9.9.9-test', database: 'unavailable' });
    expect(response.body).not.toContain('hunter2');
  });

  it('returns 503 degraded when no database is configured', async () => {
    const response = await getHealth();

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'degraded', version: '9.9.9-test', database: 'unavailable' });
  });

  it('ignores an invalid token instead of rejecting it', async () => {
    app = buildApp({ config: TEST_CONFIG, database: fakeDatabase(async () => ({ rows: [] })) });
    const response = await app.inject({ url: '/health', headers: { authorization: 'Bearer garbage' } });

    expect(response.statusCode).toBe(200);
  });

  it('keeps every other route behind authentication', async () => {
    app = buildApp({ config: TEST_CONFIG });
    const response = await app.inject({ url: '/health/extra' });

    expect(response.statusCode).toBe(401);
  });
});

describe('probeDatabase', () => {
  it('times out when the database hangs', async () => {
    const hanging = fakeDatabase(() => new Promise(() => undefined));

    await expect(probeDatabase(hanging, 20)).rejects.toThrow(/timed out after 20ms/);
  });
});
