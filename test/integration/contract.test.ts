import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { validateLayout } from '@bosskantaponguttarawichien-boop/wang-raan-core';
import { buildApp } from '../../src/app.js';
import { blockedLayout, readyLayout } from '../helpers/layouts.js';
import { contractViolations, findOperation, operations, toFastifyPath } from '../helpers/contract.js';
import { signToken, TEST_CONFIG } from '../helpers/token.js';
import { createTestContext } from './harness.js';
import type { TestContext } from './harness.js';

const ALICE = 'google-alice';
const GUEST = 'guest-0f8e2a4c-1b3d-4e5f-8a9b-0c1d2e3f4a5b';
const MESSAGE = { name: 'Somchai', email: 'somchai@example.com', message: 'อยากสอบถามเรื่องการจัดร้าน' };
const UNKNOWN_KEY = 'A'.repeat(43);
// สัญญามี UNSUPPORTED_MEDIA_TYPE ใน ErrorCode แต่ไม่ได้ประกาศ 415 ใน responses ของ endpoint ใด
// ตรวจ body ของ 415 กับ Error schema แทน (บันทึกเป็นช่องว่างของสัญญาใน harness)
const UNDOCUMENTED_BUT_EXPECTED = new Set([415]);

interface Scenario {
  name: string;
  method: string;
  path: string;
  status: number;
  sub?: string | null;
  url?: string;
  payload?: unknown;
  headers?: Record<string, string>;
  rawBody?: string;
}

describe('OpenAPI v1.3.0 contract (PostgreSQL)', () => {
  let ctx: TestContext;
  let shareKey = '';
  let revokedKey = '';
  let expiredKey = '';
  const exercised = new Set<number>();
  const otpCodes = new Map<string, string>();

  async function send(scenario: Scenario): Promise<LightMyRequestResponse> {
    const options: InjectOptions = {
      method: scenario.method as InjectOptions['method'],
      url: scenario.url ?? scenario.path,
      headers: { 'x-request-id': crypto.randomUUID(), 'x-client-ip': '203.0.113.1', ...scenario.headers },
    };
    if (scenario.rawBody !== undefined) options.payload = scenario.rawBody;
    else if (scenario.payload !== undefined) options.payload = scenario.payload as object;
    if (scenario.sub !== null) {
      options.headers = {
        ...options.headers,
        authorization: `Bearer ${await signToken({ sub: scenario.sub ?? ALICE })}`,
      };
    }
    return ctx.app.inject(options);
  }

  async function check(scenario: Scenario): Promise<void> {
    const response = await send(scenario);
    expect(response.statusCode, `${scenario.name}: ${response.body}`).toBe(scenario.status);
    exercised.add(response.statusCode);

    const operation = findOperation(scenario.method, scenario.path);
    const problems = contractViolations(operation, response).filter(
      (problem) => !(UNDOCUMENTED_BUT_EXPECTED.has(response.statusCode) && problem.includes('is not documented')),
    );
    if (UNDOCUMENTED_BUT_EXPECTED.has(response.statusCode)) {
      expect(response.json()).toEqual({ error: { code: expect.any(String), message: expect.any(String) } });
    }
    expect(problems, scenario.name).toEqual([]);
  }

  beforeAll(async () => {
    ctx = await createTestContext({
      mailer: {
        async sendOtp(email, code) {
          otpCodes.set(email, code);
        },
      },
    });
    await ctx.reset();

    const post = (sub: string, url: string, payload: unknown) =>
      ctx.as(sub, { method: 'POST', url, payload: payload as object });
    await post(ALICE, '/v1/layouts', { layout: readyLayout() });
    await post(ALICE, '/v1/layouts', { layout: readyLayout('to-delete') });
    await post(GUEST, '/v1/layouts', { layout: readyLayout() });
    shareKey = (await post(ALICE, '/v1/layouts/cafe-1/shares', {})).json().shareKey;
    revokedKey = (await post(ALICE, '/v1/layouts/cafe-1/shares', {})).json().shareKey;
    expiredKey = (await post(ALICE, '/v1/layouts/cafe-1/shares', {})).json().shareKey;
    await ctx.as(ALICE, { method: 'DELETE', url: `/v1/shares/${revokedKey}` });
    await ctx.pool.query("UPDATE share_links SET expires_at = now() - interval '1 second' WHERE share_key = $1", [
      expiredKey,
    ]);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('implements every operation in the contract', () => {
    for (const operation of operations()) {
      expect(
        ctx.app.hasRoute({ method: operation.method as 'GET', url: toFastifyPath(operation.path) }),
        `${operation.method} ${operation.path}`,
      ).toBe(true);
    }
  });

  it('enforces security and x-allow-anonymous on every operation', async () => {
    for (const operation of operations()) {
      const url = toFastifyPath(operation.path).replace(':layoutId', 'cafe-1').replace(':shareKey', shareKey);
      const noToken = await send({
        name: 'no token',
        method: operation.method,
        path: operation.path,
        url,
        status: 0,
        sub: null,
      });
      const anonymous = await send({
        name: 'anonymous',
        method: operation.method,
        path: operation.path,
        url,
        status: 0,
        sub: 'anonymous',
      });

      if (operation.public) {
        expect(noToken.statusCode, operation.operationId).not.toBe(401);
        continue;
      }
      expect(noToken.statusCode, operation.operationId).toBe(401);
      exercised.add(401);
      expect(contractViolations(operation, noToken), operation.operationId).toEqual([]);
      if (operation.allowAnonymous) expect(anonymous.statusCode, operation.operationId).not.toBe(401);
      else expect(anonymous.statusCode, operation.operationId).toBe(401);
    }
  });

  it('answers every scenario in the documented shape', async () => {
    const L = '/v1/layouts';
    const LI = '/v1/layouts/{layoutId}';
    const LS = '/v1/layouts/{layoutId}/shares';
    const S = '/v1/shares/{shareKey}';
    const P = '/v1/public/shares/{shareKey}';
    const C = '/v1/contact-messages';
    const R = '/v1/auth/identities/resolve';
    const OR = '/v1/auth/otp/request';
    const OV = '/v1/auth/otp/verify';
    const scenarios: Scenario[] = [
      { name: 'health ok', method: 'GET', path: '/health', status: 200, sub: null },
      { name: 'list layouts', method: 'GET', path: L, status: 200 },
      { name: 'create layout', method: 'POST', path: L, status: 201, payload: { layout: readyLayout('new') } },
      { name: 'create duplicate', method: 'POST', path: L, status: 409, payload: { layout: readyLayout() } },
      { name: 'create blocked', method: 'POST', path: L, status: 422, payload: { layout: blockedLayout() } },
      { name: 'create bad schema', method: 'POST', path: L, status: 400, payload: { layout: { id: 'x' } } },
      {
        name: 'create bad json',
        method: 'POST',
        path: L,
        status: 400,
        rawBody: '{"layout":',
        headers: { 'content-type': 'application/json' },
      },
      {
        name: 'create huge',
        method: 'POST',
        path: L,
        status: 413,
        payload: { layout: readyLayout(), pad: 'x'.repeat(600 * 1024) },
      },
      {
        name: 'create not json',
        method: 'POST',
        path: L,
        status: 415,
        rawBody: 'hello',
        headers: { 'content-type': 'text/plain' },
      },
      { name: 'get layout', method: 'GET', path: LI, url: '/v1/layouts/cafe-1', status: 200 },
      { name: 'get missing layout', method: 'GET', path: LI, url: '/v1/layouts/nope', status: 404 },
      {
        name: 'put layout',
        method: 'PUT',
        path: LI,
        url: '/v1/layouts/cafe-1',
        status: 200,
        payload: { layout: readyLayout() },
      },
      {
        name: 'put mismatch',
        method: 'PUT',
        path: LI,
        url: '/v1/layouts/cafe-1',
        status: 400,
        payload: { layout: readyLayout('zzz') },
      },
      {
        name: 'put blocked',
        method: 'PUT',
        path: LI,
        url: '/v1/layouts/cafe-1',
        status: 422,
        payload: { layout: blockedLayout('cafe-1') },
      },
      {
        name: 'put missing',
        method: 'PUT',
        path: LI,
        url: '/v1/layouts/nope',
        status: 404,
        payload: { layout: readyLayout('nope') },
      },
      { name: 'delete layout', method: 'DELETE', path: LI, url: '/v1/layouts/to-delete', status: 204 },
      { name: 'delete missing', method: 'DELETE', path: LI, url: '/v1/layouts/to-delete', status: 404 },
      { name: 'list shares', method: 'GET', path: LS, url: '/v1/layouts/cafe-1/shares', status: 200 },
      { name: 'list shares missing', method: 'GET', path: LS, url: '/v1/layouts/nope/shares', status: 404 },
      { name: 'create share', method: 'POST', path: LS, url: '/v1/layouts/cafe-1/shares', status: 201, payload: {} },
      {
        name: 'create share bad expiry',
        method: 'POST',
        path: LS,
        url: '/v1/layouts/cafe-1/shares',
        status: 400,
        payload: { expiresAt: '2000-01-01T00:00:00Z' },
      },
      {
        name: 'create share missing layout',
        method: 'POST',
        path: LS,
        url: '/v1/layouts/nope/shares',
        status: 404,
        payload: {},
      },
      {
        name: 'patch share',
        method: 'PATCH',
        path: S,
        url: `/v1/shares/${shareKey}`,
        status: 200,
        payload: { expiresAt: null },
      },
      {
        name: 'patch share invalid',
        method: 'PATCH',
        path: S,
        url: `/v1/shares/${shareKey}`,
        status: 400,
        payload: {},
      },
      {
        name: 'patch share missing',
        method: 'PATCH',
        path: S,
        url: `/v1/shares/${UNKNOWN_KEY}`,
        status: 404,
        payload: { expiresAt: null },
      },
      {
        name: 'patch share revoked',
        method: 'PATCH',
        path: S,
        url: `/v1/shares/${revokedKey}`,
        status: 410,
        payload: { expiresAt: null },
      },
      { name: 'revoke share', method: 'DELETE', path: S, url: `/v1/shares/${revokedKey}`, status: 204 },
      { name: 'revoke missing', method: 'DELETE', path: S, url: `/v1/shares/${UNKNOWN_KEY}`, status: 404 },
      {
        name: 'public share',
        method: 'GET',
        path: P,
        url: `/v1/public/shares/${shareKey}`,
        status: 200,
        sub: 'anonymous',
      },
      {
        name: 'public revoked',
        method: 'GET',
        path: P,
        url: `/v1/public/shares/${revokedKey}`,
        status: 410,
        sub: 'anonymous',
      },
      {
        name: 'public expired',
        method: 'GET',
        path: P,
        url: `/v1/public/shares/${expiredKey}`,
        status: 410,
        sub: 'anonymous',
      },
      {
        name: 'public missing',
        method: 'GET',
        path: P,
        url: `/v1/public/shares/${UNKNOWN_KEY}`,
        status: 404,
        sub: 'anonymous',
      },
      { name: 'contact', method: 'POST', path: C, status: 202, sub: 'anonymous', payload: MESSAGE },
      { name: 'contact invalid', method: 'POST', path: C, status: 400, sub: 'anonymous', payload: { name: 'x' } },
      {
        name: 'contact huge',
        method: 'POST',
        path: C,
        status: 413,
        sub: 'anonymous',
        payload: { ...MESSAGE, message: 'x'.repeat(9000) },
      },
      { name: 'me missing', method: 'GET', path: '/v1/me', status: 404, sub: 'github-newcomer' },
      {
        name: 'upsert me',
        method: 'PUT',
        path: '/v1/me',
        status: 200,
        payload: {
          name: 'n'.repeat(200),
          email: `${'e'.repeat(240)}@example.com`,
          image: `https://img.example/${'i'.repeat(2020)}`,
        },
      },
      { name: 'upsert me invalid', method: 'PUT', path: '/v1/me', status: 400, payload: { provider: 'google' } },
      {
        name: 'upsert me unknown user',
        method: 'PUT',
        path: '/v1/me',
        status: 404,
        sub: 'usr-00000000-0000-4000-8000-000000000000',
        payload: { name: 'x' },
      },
      { name: 'get me', method: 'GET', path: '/v1/me', status: 200 },
      { name: 'export me', method: 'GET', path: '/v1/me/export', status: 200 },
      {
        name: 'merge guest',
        method: 'POST',
        path: '/v1/me/merge-guest',
        status: 200,
        payload: { guestId: GUEST },
      },
      {
        name: 'merge guest invalid',
        method: 'POST',
        path: '/v1/me/merge-guest',
        status: 400,
        payload: { guestId: 'google-1' },
      },
      { name: 'delete me', method: 'DELETE', path: '/v1/me', status: 204 },
      { name: 'resolve guest', method: 'POST', path: R, status: 200, sub: 'anonymous', payload: { provider: 'guest' } },
      {
        name: 'resolve google',
        method: 'POST',
        path: R,
        status: 200,
        sub: 'anonymous',
        payload: {
          provider: 'google',
          providerAccountId: '1098765',
          email: 'g@example.com',
          emailVerified: true,
          name: 'G',
          image: 'https://img.example/g.png',
        },
      },
      {
        name: 'resolve email provider',
        method: 'POST',
        path: R,
        status: 400,
        sub: 'anonymous',
        payload: { provider: 'email', providerAccountId: 'a@example.com', email: 'a@example.com', emailVerified: true },
      },
      {
        name: 'otp request',
        method: 'POST',
        path: OR,
        status: 200,
        sub: 'anonymous',
        payload: { email: 'o@example.com' },
      },
      {
        name: 'otp request cooldown',
        method: 'POST',
        path: OR,
        status: 429,
        sub: 'anonymous',
        payload: { email: 'o@example.com' },
      },
      {
        name: 'otp request invalid',
        method: 'POST',
        path: OR,
        status: 400,
        sub: 'anonymous',
        payload: { email: 'nope' },
      },
      {
        name: 'otp verify expired',
        method: 'POST',
        path: OV,
        status: 400,
        sub: 'anonymous',
        payload: { email: 'z@example.com', code: '123456' },
      },
    ];

    for (const scenario of scenarios) await check(scenario);
    await check({
      name: 'otp verify',
      method: 'POST',
      path: OV,
      status: 200,
      sub: 'anonymous',
      payload: { email: 'o@example.com', code: otpCodes.get('o@example.com') },
    });
    const withIdentity = (
      await ctx.pool.query<{ user_id: string }>("SELECT user_id FROM identities WHERE provider = 'google'")
    ).rows[0]!.user_id;
    await check({
      name: 'export with identities',
      method: 'GET',
      path: '/v1/me/export',
      status: 200,
      sub: withIdentity,
    });

    // 429: ส่งจาก IP เดียวจนเกินโควตา
    for (let i = 0; i < 5; i += 1) {
      await send({
        name: 'fill',
        method: 'POST',
        path: C,
        status: 0,
        sub: 'anonymous',
        payload: MESSAGE,
        headers: { 'x-client-ip': '198.51.100.9' },
      });
    }
    await check({
      name: 'contact rate limited',
      method: 'POST',
      path: C,
      status: 429,
      sub: 'anonymous',
      payload: MESSAGE,
      headers: { 'x-client-ip': '198.51.100.9' },
    });

    // 409 LAYOUT_LIMIT_REACHED และ SHARE_LIMIT_REACHED
    const template = readyLayout();
    await ctx.pool.query("INSERT INTO users (id, provider) VALUES ('google-full', 'google')");
    await ctx.pool.query(
      `INSERT INTO layouts (owner_id, id, name, layout, validation)
       SELECT 'google-full', 'bulk-' || n, 'bulk', $1::jsonb, $2::jsonb FROM generate_series(1, 200) AS n`,
      [JSON.stringify(template), JSON.stringify(validateLayout(template))],
    );
    await check({
      name: 'layout limit',
      method: 'POST',
      path: L,
      status: 409,
      sub: 'google-full',
      payload: { layout: readyLayout('extra') },
    });
    for (let i = 0; i < 20; i += 1) {
      await send({
        name: 'fill',
        method: 'POST',
        path: LS,
        url: '/v1/layouts/bulk-1/shares',
        status: 0,
        sub: 'google-full',
        payload: {},
      });
    }
    await check({
      name: 'share limit',
      method: 'POST',
      path: LS,
      url: '/v1/layouts/bulk-1/shares',
      status: 409,
      sub: 'google-full',
      payload: {},
    });
  });

  it('reports 503 in the Health shape when the database is unavailable', async () => {
    const app = buildApp({ config: TEST_CONFIG });
    const response = await app.inject({ url: '/health' });
    await app.close();

    expect(response.statusCode).toBe(503);
    exercised.add(503);
    expect(contractViolations(findOperation('GET', '/health'), response)).toEqual([]);
  });

  it('covers every status code required by the gate', () => {
    for (const status of [200, 201, 202, 204, 400, 401, 404, 409, 410, 413, 415, 422, 429, 503]) {
      expect(exercised.has(status), `status ${status} exercised`).toBe(true);
    }
  });
});
