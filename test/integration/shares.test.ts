import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readyLayout } from '../helpers/layouts.js';
import { createTestContext } from './harness.js';
import type { TestContext } from './harness.js';

const ALICE = 'google-alice';
const BOB = 'github-bob';
const inDays = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();

describe('share links (PostgreSQL)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(async () => {
    await ctx.reset();
    await ctx.as(ALICE, { method: 'POST', url: '/v1/layouts', payload: { layout: readyLayout() } });
  });
  afterAll(async () => {
    await ctx.close();
  });

  const share = (payload: unknown = {}, sub = ALICE, layoutId = 'cafe-1') =>
    ctx.as(sub, { method: 'POST', url: `/v1/layouts/${layoutId}/shares`, payload: payload as object });

  it('creates an active share with a 43-character key', async () => {
    const response = await share();

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      shareKey: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      layoutId: 'cafe-1',
      status: 'active',
      createdAt: expect.any(String),
      expiresAt: null,
      revokedAt: null,
    });
  });

  it('accepts a POST without a body as "never expires"', async () => {
    const response = await ctx.as(ALICE, { method: 'POST', url: '/v1/layouts/cafe-1/shares' });

    expect(response.statusCode).toBe(201);
    expect(response.json().expiresAt).toBeNull();
  });

  it('freezes a snapshot of the layout at share time', async () => {
    const { shareKey } = (await share()).json();
    await ctx.as(ALICE, {
      method: 'PUT',
      url: '/v1/layouts/cafe-1',
      payload: { layout: { ...readyLayout(), version: 7 } },
    });

    const row = (await ctx.pool.query('SELECT layout FROM share_links WHERE share_key = $1', [shareKey])).rows[0];
    expect(row.layout.version).toBe(1);
  });

  it('validates expiresAt', async () => {
    const past = await share({ expiresAt: inDays(-1) });
    const tooFar = await share({ expiresAt: inDays(400) });
    const notADate = await share({ expiresAt: 'tomorrow' });
    const extraField = await share({ ownerId: BOB });
    const ok = await share({ expiresAt: inDays(30) });

    for (const response of [past, tooFar, notADate, extraField]) {
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_REQUEST');
      expect(response.json().error.details.length).toBeGreaterThan(0);
    }
    expect(ok.statusCode).toBe(201);
  });

  it('caps active shares per layout at 20, not counting revoked or expired ones', async () => {
    const keys: string[] = [];
    for (let i = 0; i < 20; i += 1) keys.push((await share()).json().shareKey);

    const limited = await share();
    expect(limited.statusCode).toBe(409);
    expect(limited.json().error.code).toBe('SHARE_LIMIT_REACHED');

    await ctx.as(ALICE, { method: 'DELETE', url: `/v1/shares/${keys[0]}` });
    await ctx.pool.query("UPDATE share_links SET expires_at = now() - interval '1 second' WHERE share_key = $1", [
      keys[1],
    ]);
    expect((await share()).statusCode).toBe(201);
    expect((await share()).statusCode).toBe(201);
    expect((await share()).statusCode).toBe(409);
  });

  it('serialises concurrent creates so the share cap holds', async () => {
    for (let i = 0; i < 18; i += 1) await share();

    const responses = await Promise.all(Array.from({ length: 5 }, () => share()));

    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(2);
  });

  it('refuses to share a layout whose latest validation is blocked', async () => {
    await ctx.pool.query(
      `UPDATE layouts SET validation = jsonb_set(validation, '{status}', '"blocked"') WHERE id = 'cafe-1'`,
    );

    const response = await share();

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('LAYOUT_BLOCKED');
  });

  it('lists all shares of a layout newest first, with computed status', async () => {
    const first = (await share()).json();
    const second = (await share({ expiresAt: inDays(1) })).json();
    await ctx.as(ALICE, { method: 'DELETE', url: `/v1/shares/${first.shareKey}` });
    await ctx.pool.query("UPDATE share_links SET created_at = created_at + interval '1 second' WHERE share_key = $1", [
      second.shareKey,
    ]);

    const response = await ctx.as(ALICE, { url: '/v1/layouts/cafe-1/shares' });

    expect(response.statusCode).toBe(200);
    expect(response.json().shares.map((s: { shareKey: string; status: string }) => [s.shareKey, s.status])).toEqual([
      [second.shareKey, 'active'],
      [first.shareKey, 'revoked'],
    ]);
  });

  it('hides other users’ layouts and shares behind 404', async () => {
    const { shareKey } = (await share()).json();

    const responses = await Promise.all([
      share({}, BOB),
      ctx.as(BOB, { url: '/v1/layouts/cafe-1/shares' }),
      ctx.as(BOB, { method: 'PATCH', url: `/v1/shares/${shareKey}`, payload: { expiresAt: null } }),
      ctx.as(BOB, { method: 'DELETE', url: `/v1/shares/${shareKey}` }),
      ctx.as(ALICE, { method: 'DELETE', url: `/v1/shares/${'z'.repeat(43)}` }),
      ctx.as(ALICE, { method: 'DELETE', url: '/v1/shares/not-a-key' }),
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('NOT_FOUND');
    }
    const row = (await ctx.pool.query('SELECT revoked_at FROM share_links')).rows[0];
    expect(row.revoked_at).toBeNull();
  });

  it('revokes idempotently and keeps the row', async () => {
    const { shareKey } = (await share()).json();

    const first = await ctx.as(ALICE, { method: 'DELETE', url: `/v1/shares/${shareKey}` });
    const revokedAt = (await ctx.pool.query('SELECT revoked_at FROM share_links')).rows[0].revoked_at;
    const second = await ctx.as(ALICE, { method: 'DELETE', url: `/v1/shares/${shareKey}` });

    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(204);
    expect((await ctx.pool.query('SELECT revoked_at FROM share_links')).rows[0].revoked_at).toEqual(revokedAt);
  });

  it('updates expiry on active and expired links and answers 410 for revoked ones', async () => {
    const active = (await share()).json();
    const revoked = (await share()).json();
    const expired = (await share({ expiresAt: inDays(1) })).json();
    await ctx.as(ALICE, { method: 'DELETE', url: `/v1/shares/${revoked.shareKey}` });
    await ctx.pool.query("UPDATE share_links SET expires_at = now() - interval '1 minute' WHERE share_key = $1", [
      expired.shareKey,
    ]);

    const newExpiry = inDays(10);
    const updated = await ctx.as(ALICE, {
      method: 'PATCH',
      url: `/v1/shares/${active.shareKey}`,
      payload: { expiresAt: newExpiry },
    });
    const gone = await ctx.as(ALICE, {
      method: 'PATCH',
      url: `/v1/shares/${revoked.shareKey}`,
      payload: { expiresAt: null },
    });
    const renewed = await ctx.as(ALICE, {
      method: 'PATCH',
      url: `/v1/shares/${expired.shareKey}`,
      payload: { expiresAt: newExpiry },
    });
    const missingField = await ctx.as(ALICE, { method: 'PATCH', url: `/v1/shares/${active.shareKey}`, payload: {} });

    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ status: 'active', expiresAt: newExpiry });
    expect(gone.statusCode).toBe(410);
    expect(gone.json().error.code).toBe('SHARE_REVOKED');
    expect(renewed.statusCode).toBe(200);
    expect(renewed.json()).toMatchObject({ status: 'active', expiresAt: newExpiry });
    expect(missingField.statusCode).toBe(400);
  });

  it('counts renewing an expired link against the share cap', async () => {
    const keys: string[] = [];
    for (let i = 0; i < 20; i += 1) keys.push((await share()).json().shareKey);
    await ctx.pool.query("UPDATE share_links SET expires_at = now() - interval '1 second' WHERE share_key = $1", [
      keys[0],
    ]);
    const replacement = await share();
    const renew = () => ctx.as(ALICE, { method: 'PATCH', url: `/v1/shares/${keys[0]}`, payload: { expiresAt: null } });

    const limited = await renew();
    await ctx.as(ALICE, { method: 'DELETE', url: `/v1/shares/${replacement.json().shareKey}` });
    const renewed = await renew();

    expect(replacement.statusCode).toBe(201);
    expect(limited.statusCode).toBe(409);
    expect(limited.json().error.code).toBe('SHARE_LIMIT_REACHED');
    expect(renewed.statusCode).toBe(200);
    expect(renewed.json()).toMatchObject({ status: 'active', expiresAt: null });
  });
});
