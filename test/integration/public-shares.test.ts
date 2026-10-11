import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readyLayout } from '../helpers/layouts.js';
import { createTestContext } from './harness.js';
import type { TestContext } from './harness.js';

const ALICE = 'google-alice';

describe('public share viewer (PostgreSQL)', () => {
  let ctx: TestContext;
  let shareKey: string;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(async () => {
    await ctx.reset();
    await ctx.as(ALICE, { method: 'POST', url: '/v1/layouts', payload: { layout: readyLayout() } });
    shareKey = (await ctx.as(ALICE, { method: 'POST', url: '/v1/layouts/cafe-1/shares', payload: {} })).json().shareKey;
  });
  afterAll(async () => {
    await ctx.close();
  });

  const view = (key = shareKey, sub = 'anonymous') =>
    ctx.as(sub, { url: `/v1/public/shares/${key}`, headers: { 'x-client-ip': '203.0.113.9' } });

  it('serves the snapshot to anonymous viewers without any owner information', async () => {
    const response = await view();

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Object.keys(body).sort()).toEqual(['createdAt', 'expiresAt', 'layout', 'validation']);
    expect(body.layout).toEqual(readyLayout());
    expect(body.validation.status).toBe('ready');
    expect(response.body).not.toContain(ALICE);
    expect(response.body).not.toContain('owner');
  });

  it('serves logged-in viewers too, but still requires a valid token', async () => {
    expect((await view(shareKey, 'line-Uviewer')).statusCode).toBe(200);
    expect((await ctx.app.inject({ url: `/v1/public/shares/${shareKey}` })).statusCode).toBe(401);
  });

  it('keeps serving the snapshot after the source layout changes', async () => {
    await ctx.as(ALICE, {
      method: 'PUT',
      url: '/v1/layouts/cafe-1',
      payload: { layout: { ...readyLayout(), version: 5 } },
    });

    expect((await view()).json().layout.version).toBe(1);
  });

  it('answers 410 SHARE_REVOKED, also after the layout is deleted', async () => {
    await ctx.as(ALICE, { method: 'DELETE', url: '/v1/layouts/cafe-1' });

    const response = await view();

    expect(response.statusCode).toBe(410);
    expect(response.json().error.code).toBe('SHARE_REVOKED');
  });

  it('answers 410 SHARE_EXPIRED for lapsed links, preferring revoked when both apply', async () => {
    await ctx.pool.query("UPDATE share_links SET expires_at = now() - interval '1 second'");
    const expired = await view();
    await ctx.pool.query('UPDATE share_links SET revoked_at = now()');
    const both = await view();

    expect(expired.statusCode).toBe(410);
    expect(expired.json().error.code).toBe('SHARE_EXPIRED');
    expect(both.json().error.code).toBe('SHARE_REVOKED');
  });

  it('answers 404 for unknown or malformed keys', async () => {
    for (const key of ['A'.repeat(43), 'short', `${shareKey}x`]) {
      const response = await view(key);
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('NOT_FOUND');
    }
  });

  it('answers 404 once the owner account is deleted', async () => {
    await ctx.pool.query('DELETE FROM users WHERE id = $1', [ALICE]);

    expect((await view()).statusCode).toBe(404);
  });
});
