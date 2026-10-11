import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { blockedLayout, readyLayout, warningLayout } from '../helpers/layouts.js';
import { createTestContext } from './harness.js';
import type { TestContext } from './harness.js';

const ALICE = 'google-alice';
const BOB = 'line-Ubob';

describe('layouts CRUD (PostgreSQL)', () => {
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

  const create = (sub: string, layout: unknown) =>
    ctx.as(sub, { method: 'POST', url: '/v1/layouts', payload: { layout } });

  async function layoutRows(): Promise<number> {
    return (await ctx.pool.query('SELECT 1 FROM layouts')).rowCount ?? 0;
  }

  it('creates a ready layout with a server-computed validation result', async () => {
    const response = await create(ALICE, readyLayout());

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.layout).toEqual(readyLayout());
    expect(body.validation).toMatchObject({ status: 'ready', issues: [] });
    expect(body.createdAt).toBe(body.updatedAt);
    expect(new Date(body.createdAt).toISOString()).toBe(body.createdAt);
  });

  it('accepts warning layouts', async () => {
    const response = await create(ALICE, warningLayout());

    expect(response.statusCode).toBe(201);
    expect(response.json().validation.status).toBe('warning');
  });

  it('rejects blocked layouts with 422 and never stores them', async () => {
    const response = await create(ALICE, blockedLayout());

    expect(response.statusCode).toBe(422);
    const { error } = response.json();
    expect(error.code).toBe('LAYOUT_BLOCKED');
    expect(error.validation.status).toBe('blocked');
    expect(error.issues.length).toBeGreaterThan(0);
    expect(error.issues.every((issue: { severity: string }) => issue.severity === 'blocked')).toBe(true);
    expect(await layoutRows()).toBe(0);
  });

  it('ignores any validation sent by the client', async () => {
    const response = await ctx.as(ALICE, {
      method: 'POST',
      url: '/v1/layouts',
      payload: { layout: blockedLayout(), validation: { status: 'ready' } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_LAYOUT_SCHEMA');
  });

  it('rejects schema violations with details', async () => {
    const response = await create(ALICE, { ...readyLayout(), width: 1 });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({
      code: 'INVALID_LAYOUT_SCHEMA',
      details: [expect.objectContaining({ path: 'layout.width' })],
    });
  });

  it('rejects non-JSON bodies with 415', async () => {
    const response = await ctx.as(ALICE, {
      method: 'POST',
      url: '/v1/layouts',
      headers: { 'content-type': 'text/plain' },
      payload: 'hello',
    });

    expect(response.statusCode).toBe(415);
    expect(response.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects a duplicate id for the same user but allows it for another user', async () => {
    await create(ALICE, readyLayout());

    const duplicate = await create(ALICE, readyLayout());
    const otherUser = await create(BOB, readyLayout());

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('LAYOUT_EXISTS');
    expect(otherUser.statusCode).toBe(201);
  });

  it('enforces the 200-layout quota', async () => {
    await create(ALICE, readyLayout('seed'));
    const template = (await ctx.pool.query('SELECT layout, validation FROM layouts WHERE id = $1', ['seed'])).rows[0];
    await ctx.pool.query(
      `INSERT INTO layouts (owner_id, id, layout, validation)
       SELECT $1, 'bulk-' || n, $2::jsonb, $3::jsonb FROM generate_series(1, 199) AS n`,
      [ALICE, template.layout, template.validation],
    );

    const response = await create(ALICE, readyLayout('one-too-many'));

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('LAYOUT_LIMIT_REACHED');
  });

  it('serialises concurrent creates so the quota cannot be exceeded', async () => {
    await create(ALICE, readyLayout('seed'));
    const template = (await ctx.pool.query('SELECT layout, validation FROM layouts WHERE id = $1', ['seed'])).rows[0];
    await ctx.pool.query(
      `INSERT INTO layouts (owner_id, id, layout, validation)
       SELECT $1, 'bulk-' || n, $2::jsonb, $3::jsonb FROM generate_series(1, 197) AS n`,
      [ALICE, template.layout, template.validation],
    );

    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, index) => create(ALICE, readyLayout(`race-${index}`))),
    );

    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(2);
    expect(await layoutRows()).toBe(200);
  });

  it('lists only the caller’s layouts, newest first', async () => {
    await create(ALICE, readyLayout('first'));
    await create(ALICE, warningLayout('second'));
    await create(BOB, readyLayout('bobs'));

    const response = await ctx.as(ALICE, { url: '/v1/layouts' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      layouts: [
        { id: 'second', width: 8, depth: 8, objectCount: 6, status: 'warning', updatedAt: expect.any(String) },
        { id: 'first', width: 8, depth: 8, objectCount: 5, status: 'ready', updatedAt: expect.any(String) },
      ],
    });
  });

  it('returns 404 (never 403) for another user’s layout', async () => {
    await create(BOB, readyLayout('secret'));

    const get = await ctx.as(ALICE, { url: '/v1/layouts/secret' });
    const put = await ctx.as(ALICE, {
      method: 'PUT',
      url: '/v1/layouts/secret',
      payload: { layout: readyLayout('secret') },
    });
    const del = await ctx.as(ALICE, { method: 'DELETE', url: '/v1/layouts/secret' });

    for (const response of [get, put, del]) {
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('NOT_FOUND');
    }
    expect((await ctx.as(BOB, { url: '/v1/layouts/secret' })).statusCode).toBe(200);
  });

  it('returns 404 for ids longer than the contract allows', async () => {
    const response = await ctx.as(ALICE, { url: `/v1/layouts/${'x'.repeat(129)}` });

    expect(response.statusCode).toBe(404);
  });

  it('updates a layout keeping createdAt and refreshing updatedAt', async () => {
    const created = (await create(ALICE, readyLayout())).json();
    const changed = { ...readyLayout(), version: 2 };

    const response = await ctx.as(ALICE, { method: 'PUT', url: '/v1/layouts/cafe-1', payload: { layout: changed } });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.layout.version).toBe(2);
    expect(body.createdAt).toBe(created.createdAt);
    expect(new Date(body.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(created.updatedAt).getTime());
  });

  it('rejects PUT with a mismatched id or a blocked layout without changing data', async () => {
    await create(ALICE, readyLayout());

    const mismatch = await ctx.as(ALICE, {
      method: 'PUT',
      url: '/v1/layouts/cafe-1',
      payload: { layout: readyLayout('other') },
    });
    const blocked = await ctx.as(ALICE, {
      method: 'PUT',
      url: '/v1/layouts/cafe-1',
      payload: { layout: blockedLayout('cafe-1') },
    });

    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().error.code).toBe('ID_MISMATCH');
    expect(blocked.statusCode).toBe(422);
    const stored = (await ctx.as(ALICE, { url: '/v1/layouts/cafe-1' })).json();
    expect(stored.validation.status).toBe('ready');
  });

  it('deletes a layout and revokes its active share links atomically', async () => {
    await create(ALICE, readyLayout());
    const snapshot = (await ctx.pool.query('SELECT layout, validation FROM layouts')).rows[0];
    await ctx.pool.query(
      `INSERT INTO share_links (share_key, owner_id, layout_id, layout, validation, revoked_at)
       VALUES ($1, $3, 'cafe-1', $4, $5, NULL), ($2, $3, 'cafe-1', $4, $5, '2026-01-01T00:00:00Z')`,
      ['a'.repeat(43), 'b'.repeat(43), ALICE, snapshot.layout, snapshot.validation],
    );

    const response = await ctx.as(ALICE, { method: 'DELETE', url: '/v1/layouts/cafe-1' });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(await layoutRows()).toBe(0);
    const shares = await ctx.pool.query('SELECT share_key, revoked_at FROM share_links ORDER BY share_key');
    expect(shares.rows[0].revoked_at).toBeInstanceOf(Date);
    expect(shares.rows[1].revoked_at.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect((await ctx.as(ALICE, { method: 'DELETE', url: '/v1/layouts/cafe-1' })).statusCode).toBe(404);
  });

  it('blocks anonymous and unrecognised subjects', async () => {
    const anonymous = await ctx.as('anonymous', { url: '/v1/layouts' });
    const unknownProvider = await create('apple-123', readyLayout());

    expect(anonymous.statusCode).toBe(401);
    expect(unknownProvider.statusCode).toBe(401);
  });
});
