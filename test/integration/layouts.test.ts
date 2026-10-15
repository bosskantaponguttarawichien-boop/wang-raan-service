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
      `INSERT INTO layouts (owner_id, id, name, layout, validation)
       SELECT $1, 'bulk-' || n, 'bulk', $2::jsonb, $3::jsonb FROM generate_series(1, 199) AS n`,
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
      `INSERT INTO layouts (owner_id, id, name, layout, validation)
       SELECT $1, 'bulk-' || n, 'bulk', $2::jsonb, $3::jsonb FROM generate_series(1, 197) AS n`,
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
        {
          id: 'second',
          name: 'ผังร้าน 8 × 8 ม.',
          width: 8,
          depth: 8,
          objectCount: 6,
          status: 'warning',
          updatedAt: expect.any(String),
          layout: warningLayout('second'),
        },
        {
          id: 'first',
          name: 'ผังร้าน 8 × 8 ม.',
          width: 8,
          depth: 8,
          objectCount: 5,
          status: 'ready',
          updatedAt: expect.any(String),
          layout: readyLayout('first'),
        },
      ],
      nextCursor: null,
    });
  });

  it('pages newest first with an opaque cursor until every layout is listed exactly once', async () => {
    for (let i = 0; i < 5; i += 1) await create(ALICE, readyLayout(`p-${i}`));
    // updated_at เท่ากัน (ระดับ microsecond) → ลำดับรองตาม id ต้องคงที่ข้ามหน้า
    await ctx.pool.query(
      "UPDATE layouts SET updated_at = '2026-10-15T00:00:00.123456Z' WHERE id IN ('p-1', 'p-2', 'p-3')",
    );

    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = cursor ? `/v1/layouts?limit=2&cursor=${encodeURIComponent(cursor)}` : '/v1/layouts?limit=2';
      const page = (await ctx.as(ALICE, { url })).json();
      expect(page.layouts.length).toBeLessThanOrEqual(2);
      ids.push(...page.layouts.map((l: { id: string }) => l.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);

    expect(pages).toBe(3);
    expect(new Set(ids).size).toBe(5);
    expect(ids.slice(-3)).toEqual(['p-1', 'p-2', 'p-3']);
  });

  it('rejects forged, tampered or foreign cursors and out-of-range limits with 400', async () => {
    for (let i = 0; i < 3; i += 1) await create(ALICE, readyLayout(`p-${i}`));
    await create(BOB, readyLayout('bobs'));
    const { nextCursor } = (await ctx.as(ALICE, { url: '/v1/layouts?limit=1' })).json();
    const [body, signature] = (nextCursor as string).split('.');
    const forged = `${Buffer.from(JSON.stringify({ u: '0', i: 'a' })).toString('base64url')}.${signature}`;

    for (const url of [
      `/v1/layouts?cursor=${forged}`,
      `/v1/layouts?cursor=${body}`,
      '/v1/layouts?cursor=nonsense',
      '/v1/layouts?limit=0',
      '/v1/layouts?limit=51',
      '/v1/layouts?owner=bob',
    ]) {
      const response = await ctx.as(ALICE, { url });
      expect(response.statusCode, url).toBe(400);
      expect(response.json().error.code, url).toBe('INVALID_REQUEST');
    }
    // cursor ของ ALICE ใช้กับ BOB ไม่ได้
    expect((await ctx.as(BOB, { url: `/v1/layouts?cursor=${encodeURIComponent(nextCursor)}` })).statusCode).toBe(400);
  });

  it('stores the trimmed name, defaults it from the room size, and keeps it on PUT without a name', async () => {
    const post = (name: unknown, id: string) =>
      ctx.as(ALICE, { method: 'POST', url: '/v1/layouts', payload: { name, layout: readyLayout(id) } as object });
    const named = await post('  ร้านกาแฟสาขาสยาม  ', 'named');
    expect(named.statusCode).toBe(201);
    expect(named.json().name).toBe('ร้านกาแฟสาขาสยาม');

    const kept = await ctx.as(ALICE, {
      method: 'PUT',
      url: '/v1/layouts/named',
      payload: { layout: readyLayout('named') },
    });
    expect(kept.json().name).toBe('ร้านกาแฟสาขาสยาม');
    const renamed = await ctx.as(ALICE, {
      method: 'PUT',
      url: '/v1/layouts/named',
      payload: { name: 'ร้านใหม่', layout: readyLayout('named') },
    });
    expect(renamed.json().name).toBe('ร้านใหม่');

    // 80 code point ได้ (emoji นอก BMP นับเป็น 1), 81 หรือช่องว่างล้วนไม่ได้
    const emoji = '🍰'.repeat(80);
    expect((await post(emoji, 'emoji')).json().name).toBe(emoji);
    for (const name of ['🍰'.repeat(81), '   ', 42]) {
      const response = await post(name, 'bad');
      expect(response.statusCode, String(name)).toBe(400);
      expect(response.json().error.code).toBe('INVALID_LAYOUT_SCHEMA');
    }
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
