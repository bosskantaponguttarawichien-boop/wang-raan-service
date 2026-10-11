import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { BODY_LIMITS } from '../src/middleware/payload-limiter.js';
import { signToken, TEST_CONFIG } from './helpers/token.js';

const REQUEST_ID = '6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d';

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe('security, auth & tracing middleware', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp({ config: TEST_CONFIG });
    app.get('/private', async (request) => ({ auth: request.auth, clientIp: request.clientIp }));
    app.get('/public', { config: { auth: 'anonymous' } }, async (request) => ({ auth: request.auth }));
    app.get('/open', { config: { auth: 'none' } }, async (request) => ({ auth: request.auth }));
    app.get('/items/:id', async () => ({}));
    app.post('/echo', async (request) => ({ body: request.body }));
    app.post('/layout', { bodyLimit: BODY_LIMITS.layout }, async () => ({ ok: true }));
    app.get('/boom', async () => {
      throw new Error('database password leaked in message');
    });
    app.get('/zod', async () => z.object({ name: z.string() }).parse({}));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('internal JWT', () => {
    it('accepts a valid token and exposes sub from the token', async () => {
      const response = await app.inject({ url: '/private', headers: bearer(await signToken()) });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ auth: { userId: 'google-1234', isAnonymous: false } });
    });

    it.each([
      ['missing header', async () => ({})],
      ['non-bearer scheme', async () => ({ authorization: `Basic ${await signToken()}` })],
      ['garbage token', async () => bearer('not-a-jwt')],
      ['wrong secret', async () => bearer(await signToken({ secret: 'another-secret-0123456789abcdef0123' }))],
      ['wrong issuer', async () => bearer(await signToken({ iss: 'evil' }))],
      ['wrong audience', async () => bearer(await signToken({ aud: 'other-service' }))],
      ['wrong algorithm', async () => bearer(await signToken({ alg: 'HS512' }))],
      ['missing sub', async () => bearer(await signToken({ sub: null }))],
      ['empty sub', async () => bearer(await signToken({ sub: '' }))],
      ['oversized sub', async () => bearer(await signToken({ sub: `google-${'x'.repeat(130)}` }))],
      [
        'expired token',
        async () => {
          const iat = Math.floor(Date.now() / 1000) - 400;
          return bearer(await signToken({ iat, exp: iat + 300 }));
        },
      ],
      [
        'lifetime above 300s',
        async () => {
          const iat = Math.floor(Date.now() / 1000);
          return bearer(await signToken({ iat, exp: iat + 3600 }));
        },
      ],
      ['issued in the future', async () => bearer(await signToken({ iat: Math.floor(Date.now() / 1000) + 60 }))],
    ])('rejects %s with 401 UNAUTHORIZED', async (_label, headers) => {
      const response = await app.inject({ url: '/private', headers: await headers() });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: expect.any(String) } });
    });

    it('tolerates 5 seconds of clock skew on expiry', async () => {
      const iat = Math.floor(Date.now() / 1000) - 303;
      const response = await app.inject({ url: '/private', headers: bearer(await signToken({ iat, exp: iat + 300 })) });

      expect(response.statusCode).toBe(200);
    });

    it('rejects anonymous on routes without x-allow-anonymous', async () => {
      const response = await app.inject({ url: '/private', headers: bearer(await signToken({ sub: 'anonymous' })) });

      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('UNAUTHORIZED');
    });

    it('allows anonymous on anonymous-enabled routes but still requires a token', async () => {
      const ok = await app.inject({ url: '/public', headers: bearer(await signToken({ sub: 'anonymous' })) });
      const noToken = await app.inject({ url: '/public' });

      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toEqual({ auth: { userId: 'anonymous', isAnonymous: true } });
      expect(noToken.statusCode).toBe(401);
    });

    it('skips auth on routes marked auth: none', async () => {
      const response = await app.inject({ url: '/open' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ auth: null });
    });

    it('authenticates before answering unknown routes', async () => {
      const anonymous = await app.inject({ url: '/nope' });
      const authed = await app.inject({ url: '/nope', headers: bearer(await signToken()) });

      expect(anonymous.statusCode).toBe(401);
      expect(authed.statusCode).toBe(404);
      expect(authed.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'route not found' } });
    });
  });

  it('answers malformed and over-long URLs in the contract error format', async () => {
    const badUrl = await app.inject({ url: '/items/%E0%A4%A' });
    const longParam = await app.inject({ url: `/items/${'x'.repeat(3000)}` });

    for (const response of [badUrl, longParam]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'route not found' } });
    }
  });

  describe('tracing headers', () => {
    it('propagates X-Request-Id and reads X-Client-IP', async () => {
      const response = await app.inject({
        url: '/private',
        headers: { ...bearer(await signToken()), 'x-request-id': REQUEST_ID, 'x-client-ip': ' 203.0.113.7 ' },
      });

      expect(response.headers['x-request-id']).toBe(REQUEST_ID);
      expect(response.json().clientIp).toBe('203.0.113.7');
    });

    it('generates a request id when the header is missing or not a UUID', async () => {
      const response = await app.inject({
        url: '/private',
        headers: { ...bearer(await signToken()), 'x-request-id': 'bad\nvalue', 'x-client-ip': 'x'.repeat(65) },
      });

      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.headers['x-request-id']).not.toBe('bad\nvalue');
      expect(response.json().clientIp).toBeNull();
    });

    it('sets the request id even on rejected requests', async () => {
      const response = await app.inject({ url: '/private', headers: { 'x-request-id': REQUEST_ID } });

      expect(response.statusCode).toBe(401);
      expect(response.headers['x-request-id']).toBe(REQUEST_ID);
    });
  });

  describe('payload limits & body errors', () => {
    it('rejects bodies above the default 1 KB limit with 413', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/echo',
        headers: bearer(await signToken()),
        payload: { text: 'x'.repeat(BODY_LIMITS.default) },
      });

      expect(response.statusCode).toBe(413);
      expect(response.json()).toEqual({ error: { code: 'PAYLOAD_TOO_LARGE', message: expect.any(String) } });
    });

    it('allows layout routes up to 512 KB and rejects beyond', async () => {
      const headers = bearer(await signToken());
      const fits = await app.inject({
        method: 'POST',
        url: '/layout',
        headers,
        payload: { text: 'x'.repeat(BODY_LIMITS.layout - 100) },
      });
      const tooBig = await app.inject({
        method: 'POST',
        url: '/layout',
        headers,
        payload: { text: 'x'.repeat(BODY_LIMITS.layout) },
      });

      expect(fits.statusCode).toBe(200);
      expect(tooBig.statusCode).toBe(413);
    });

    it('checks auth before reading the body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/layout',
        payload: { text: 'x'.repeat(BODY_LIMITS.layout + 1) },
      });

      expect(response.statusCode).toBe(401);
    });

    it('maps malformed JSON to 400 INVALID_JSON', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/echo',
        headers: { ...bearer(await signToken()), 'content-type': 'application/json' },
        payload: '{"broken":',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_JSON');
    });

    it('maps non-JSON content types to 415 UNSUPPORTED_MEDIA_TYPE', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/echo',
        headers: { ...bearer(await signToken()), 'content-type': 'application/xml' },
        payload: '<a/>',
      });

      expect(response.statusCode).toBe(415);
      expect(response.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });
  });

  describe('uniform error handler', () => {
    it('hides internal error details behind 500 INTERNAL_ERROR', async () => {
      const response = await app.inject({ url: '/boom', headers: bearer(await signToken()) });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'internal server error' } });
      expect(response.body).not.toContain('password');
    });

    it('maps Zod errors to 400 INVALID_REQUEST with details', async () => {
      const response = await app.inject({ url: '/zod', headers: bearer(await signToken()) });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: {
          code: 'INVALID_REQUEST',
          message: 'request validation failed',
          details: [{ path: 'name', message: 'Required' }],
        },
      });
    });
  });
});
