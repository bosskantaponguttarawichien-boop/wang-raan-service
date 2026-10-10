import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('Fastify bootstrap', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it('starts and stops an HTTP server', async () => {
    app = buildApp({ logger: false });

    const address = await app.listen({ host: '127.0.0.1', port: 0 });

    expect(address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});
