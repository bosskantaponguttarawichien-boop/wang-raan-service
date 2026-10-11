import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { computeLayoutRevision } from '@bosskantaponguttarawichien-boop/wang-raan-core';
import { readyLayout, warningLayout } from '../helpers/layouts.js';
import { createTestContext } from './harness.js';
import type { TestContext } from './harness.js';

const ALICE = 'google-alice';
const GUEST = 'guest-0f8e2a4c-1b3d-4e5f-8a9b-0c1d2e3f4a5b';
const OTHER_GUEST = 'guest-11111111-2222-4333-8444-555555555555';

describe('account & PDPA (PostgreSQL)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(async () => {
    await ctx.reset();
  });
  afterAll(async () => {
    await ctx.close();
  });

  const createLayout = (sub: string, layout: unknown) =>
    ctx.as(sub, { method: 'POST', url: '/v1/layouts', payload: { layout } });
  const createShare = async (sub: string, layoutId: string) =>
    (await ctx.as(sub, { method: 'POST', url: `/v1/layouts/${layoutId}/shares`, payload: {} })).json().shareKey;
  const count = async (sql: string, params: unknown[] = []) =>
    (await ctx.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, params)).rows[0]?.n;

  describe('GET/PUT /v1/me', () => {
    it('returns 404 before the first upsert', async () => {
      const response = await ctx.as(ALICE, { url: '/v1/me' });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('NOT_FOUND');
    });

    it('upserts the profile, keeping omitted fields and clearing explicit nulls', async () => {
      const created = await ctx.as(ALICE, {
        method: 'PUT',
        url: '/v1/me',
        payload: { provider: 'google', name: 'Alice', email: 'alice@example.com', image: 'https://img.example/a.png' },
      });
      const updated = await ctx.as(ALICE, {
        method: 'PUT',
        url: '/v1/me',
        payload: { provider: 'google', image: null },
      });

      expect(created.statusCode).toBe(200);
      expect(updated.json()).toEqual({
        id: ALICE,
        provider: 'google',
        name: 'Alice',
        email: 'alice@example.com',
        image: null,
        createdAt: created.json().createdAt,
        updatedAt: expect.any(String),
      });
      expect((await ctx.as(ALICE, { url: '/v1/me' })).json()).toEqual(updated.json());
    });

    it('validates the profile and ties provider to the token subject', async () => {
      const cases = [
        { provider: 'line' },
        { provider: 'google', email: 'not-an-email' },
        { provider: 'google', image: 'not a url' },
        { provider: 'google', name: 'x'.repeat(201) },
        { provider: 'google', id: 'line-mallory' },
        {},
      ];

      for (const payload of cases) {
        const response = await ctx.as(ALICE, { method: 'PUT', url: '/v1/me', payload });
        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe('INVALID_REQUEST');
      }
      expect(await count('users')).toBe(0);
    });
  });

  describe('DELETE /v1/me', () => {
    it('erases the profile and every piece of data tied to the user, and is idempotent', async () => {
      await ctx.as(ALICE, { method: 'PUT', url: '/v1/me', payload: { provider: 'google', name: 'Alice' } });
      await createLayout(ALICE, readyLayout());
      await createShare(ALICE, 'cafe-1');
      await ctx.pool.query(
        `INSERT INTO contact_messages (user_id, name, email, message) VALUES ($1, 'A', 'a@example.com', 'hello there!')`,
        [ALICE],
      );
      await ctx.pool.query(`INSERT INTO rate_limits (key, window_start, count) VALUES ($1, now(), 1)`, [
        `contact:user:${ALICE}`,
      ]);
      await createLayout('google-bob', readyLayout());

      const first = await ctx.as(ALICE, { method: 'DELETE', url: '/v1/me' });
      const second = await ctx.as(ALICE, { method: 'DELETE', url: '/v1/me' });

      expect(first.statusCode).toBe(204);
      expect(second.statusCode).toBe(204);
      expect(await count('users WHERE id = $1', [ALICE])).toBe(0);
      expect(await count('layouts WHERE owner_id = $1', [ALICE])).toBe(0);
      expect(await count('share_links WHERE owner_id = $1', [ALICE])).toBe(0);
      expect(await count('contact_messages WHERE user_id = $1', [ALICE])).toBe(0);
      expect(await count('rate_limits WHERE key LIKE $1', [`%${ALICE}%`])).toBe(0);
      expect(await count('layouts WHERE owner_id = $1', ['google-bob'])).toBe(1);
    });
  });

  describe('GET /v1/me/export', () => {
    it('exports the profile, layouts, shares and contact messages', async () => {
      await ctx.as(ALICE, { method: 'PUT', url: '/v1/me', payload: { provider: 'google', name: 'Alice' } });
      await createLayout(ALICE, readyLayout());
      const shareKey = await createShare(ALICE, 'cafe-1');
      await ctx.pool.query(
        `INSERT INTO contact_messages (user_id, name, email, message) VALUES ($1, 'A', 'a@example.com', 'hello there!')`,
        [ALICE],
      );

      const response = await ctx.as(ALICE, { url: '/v1/me/export' });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Object.keys(body).sort()).toEqual(['contactMessages', 'exportedAt', 'layouts', 'shares', 'user']);
      expect(body.user).toMatchObject({ id: ALICE, name: 'Alice' });
      expect(body.layouts).toHaveLength(1);
      expect(body.layouts[0].layout).toEqual(readyLayout());
      expect(body.shares).toEqual([expect.objectContaining({ shareKey, status: 'active' })]);
      expect(body.contactMessages).toEqual([
        { name: 'A', email: 'a@example.com', message: 'hello there!', receivedAt: expect.any(String) },
      ]);
    });

    it('exports an empty account for users without any stored data, without creating one', async () => {
      const response = await ctx.as(ALICE, { url: '/v1/me/export' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        user: { id: ALICE, provider: 'google', name: null },
        layouts: [],
        shares: [],
        contactMessages: [],
      });
      expect(await count('users')).toBe(0);
    });
  });

  describe('POST /v1/me/merge-guest', () => {
    const merge = (sub: string, guestId: string) =>
      ctx.as(sub, { method: 'POST', url: '/v1/me/merge-guest', payload: { guestId } });

    it('moves guest layouts and shares, renaming id collisions and revalidating them', async () => {
      await createLayout(ALICE, readyLayout('cafe-1'));
      await createLayout(GUEST, readyLayout('cafe-1'));
      await createLayout(GUEST, warningLayout('patio'));
      const guestShare = await createShare(GUEST, 'cafe-1');
      await ctx.pool.query(
        `INSERT INTO contact_messages (user_id, name, email, message) VALUES ($1, 'G', 'g@example.com', 'guest message')`,
        [GUEST],
      );

      const response = await merge(ALICE, GUEST);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        movedLayouts: 2,
        movedShares: 1,
        renamed: [{ from: 'cafe-1', to: 'cafe-1-guest-copy' }],
      });

      const renamed = (await ctx.as(ALICE, { url: '/v1/layouts/cafe-1-guest-copy' })).json();
      expect(renamed.layout.id).toBe('cafe-1-guest-copy');
      expect(renamed.validation.layoutRevision).toBe(computeLayoutRevision(renamed.layout));
      expect((await ctx.as(ALICE, { url: '/v1/layouts/patio' })).statusCode).toBe(200);

      const share = (await ctx.as(ALICE, { url: '/v1/layouts/cafe-1-guest-copy/shares' })).json().shares;
      expect(share.map((s: { shareKey: string }) => s.shareKey)).toEqual([guestShare]);
      expect((await ctx.as('anonymous', { url: `/v1/public/shares/${guestShare}` })).statusCode).toBe(200);

      expect(await count('users WHERE id = $1', [GUEST])).toBe(0);
      expect(await count('contact_messages WHERE user_id = $1', [ALICE])).toBe(1);
    });

    it('is idempotent: repeating the merge moves nothing', async () => {
      await createLayout(GUEST, readyLayout());
      await merge(ALICE, GUEST);

      const again = await merge(ALICE, GUEST);

      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual({ movedLayouts: 0, movedShares: 0, renamed: [] });
      expect(await count('layouts WHERE owner_id = $1', [ALICE])).toBe(1);
    });

    it('rejects guests merging guests and malformed guest ids', async () => {
      const guestToGuest = await merge(OTHER_GUEST, GUEST);
      const malformed = await merge(ALICE, 'google-123');

      for (const response of [guestToGuest, malformed]) {
        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe('INVALID_REQUEST');
      }
    });

    it('rolls back everything when a step fails mid-merge', async () => {
      await createLayout(GUEST, readyLayout('a'));
      await createLayout(GUEST, readyLayout('b'));
      await createShare(GUEST, 'a');
      // ทำให้ขั้นย้ายลิงก์แชร์ล้มเหลวกลาง transaction หลังย้ายผังไปแล้ว
      await ctx.pool.query(`
        CREATE OR REPLACE FUNCTION fail_share_move() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'simulated failure'; END $$ LANGUAGE plpgsql;
        CREATE TRIGGER fail_share_move BEFORE UPDATE OF owner_id ON share_links
          FOR EACH ROW EXECUTE FUNCTION fail_share_move();
      `);

      try {
        const response = await merge(ALICE, GUEST);

        expect(response.statusCode).toBe(500);
        expect(response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'internal server error' } });
        expect(await count('layouts WHERE owner_id = $1', [GUEST])).toBe(2);
        expect(await count('layouts WHERE owner_id = $1', [ALICE])).toBe(0);
        expect(await count('users WHERE id = $1', [GUEST])).toBe(1);
      } finally {
        await ctx.pool.query('DROP TRIGGER fail_share_move ON share_links; DROP FUNCTION fail_share_move();');
      }
    });
  });
});
