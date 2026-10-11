import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContactNotification, Notifier } from '../../src/services/notifier.js';
import { deleteStaleRateLimits } from '../../src/services/rate-limit-janitor.js';
import { createTestContext } from './harness.js';
import type { TestContext } from './harness.js';

// กลางหน้าต่าง 10 นาที — เทสไม่ข้ามขอบหน้าต่างแม้รันช้า
const NOW = new Date('2026-10-11T08:15:00.000Z');
const MESSAGE = { name: 'Somchai', email: 'somchai@example.com', message: 'อยากสอบถามเรื่องการจัดร้าน' };

describe('contact messages & rate limiting (PostgreSQL)', () => {
  let ctx: TestContext;
  const sent: ContactNotification[] = [];
  const notifier: Notifier = {
    notifyContactMessage: vi.fn(async (notification: ContactNotification) => {
      sent.push(notification);
    }),
  };

  beforeAll(async () => {
    ctx = await createTestContext({ notifier, clock: () => NOW });
  });
  beforeEach(async () => {
    await ctx.reset();
    sent.length = 0;
  });
  afterAll(async () => {
    await ctx.close();
  });

  const submit = (options: { sub?: string; ip?: string | null; payload?: unknown } = {}) =>
    ctx.as(options.sub ?? 'anonymous', {
      method: 'POST',
      url: '/v1/contact-messages',
      headers: options.ip === null ? {} : { 'x-client-ip': options.ip ?? '203.0.113.1' },
      payload: (options.payload ?? MESSAGE) as object,
    });

  it('accepts an anonymous message, stores it and notifies the team', async () => {
    const response = await submit({ payload: { ...MESSAGE, name: '  Somchai  ' } });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), receivedAt: expect.any(String) });
    const row = (await ctx.pool.query('SELECT * FROM contact_messages')).rows[0];
    expect(row).toMatchObject({ id: body.id, user_id: null, name: 'Somchai', client_ip: '203.0.113.1' });
    expect(sent).toEqual([{ ...MESSAGE, id: body.id, receivedAt: body.receivedAt }]);
  });

  it('links messages from signed-in users to their account', async () => {
    await submit({ sub: 'line-Ucustomer' });

    const row = (await ctx.pool.query('SELECT user_id FROM contact_messages')).rows[0];
    expect(row.user_id).toBe('line-Ucustomer');
  });

  it('validates the body against ContactMessageRequest', async () => {
    const cases = [
      { ...MESSAGE, email: 'nope' },
      { ...MESSAGE, message: 'short' },
      { ...MESSAGE, name: '' },
      { ...MESSAGE, website: 'http://spam.example' },
      { name: 'x' },
    ];

    for (const payload of cases) {
      const response = await submit({ payload });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_REQUEST');
    }
    expect(sent).toHaveLength(0);
  });

  it('requires X-Client-IP and caps the body at 8 KB', async () => {
    const noIp = await submit({ ip: null });
    const tooBig = await submit({ payload: { ...MESSAGE, message: 'x'.repeat(9000) } });

    expect(noIp.statusCode).toBe(400);
    expect(noIp.json().error.details).toEqual([expect.objectContaining({ path: 'X-Client-IP' })]);
    expect(tooBig.statusCode).toBe(413);
  });

  it('limits each IP to 5 messages per window with Retry-After, without consuming quota on rejection', async () => {
    for (let i = 0; i < 5; i += 1) expect((await submit()).statusCode).toBe(202);

    const limited = await submit();
    const otherIp = await submit({ ip: '198.51.100.7' });

    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('300');
    expect(limited.json()).toEqual({
      error: { code: 'RATE_LIMITED', message: expect.any(String), retryAfter: 300 },
    });
    expect(otherIp.statusCode).toBe(202);
    const counts = await ctx.pool.query(
      "SELECT key, count FROM rate_limits WHERE key LIKE 'contact:ip:%' ORDER BY key",
    );
    expect(counts.rows).toEqual([
      { key: 'contact:ip:198.51.100.7', count: 1 },
      { key: 'contact:ip:203.0.113.1', count: 5 },
    ]);
    expect(await ctx.pool.query('SELECT 1 FROM contact_messages').then((r) => r.rowCount)).toBe(6);
  });

  it('limits each signed-in user to 5 messages per window across IPs', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await submit({ sub: 'google-chatty', ip: `192.0.2.${i}` })).statusCode).toBe(202);
    }

    expect((await submit({ sub: 'google-chatty', ip: '192.0.2.99' })).statusCode).toBe(429);
    expect((await submit({ sub: 'anonymous', ip: '192.0.2.99' })).statusCode).toBe(202);
  });

  it('enforces the global cap of 50 per window, also under concurrency', async () => {
    const responses = await Promise.all(
      Array.from({ length: 60 }, (_, i) => submit({ ip: `10.0.${Math.floor(i / 5)}.${i % 5}` })),
    );

    expect(responses.filter((r) => r.statusCode === 202)).toHaveLength(50);
    expect(responses.filter((r) => r.statusCode === 429)).toHaveLength(10);
  });

  it('keeps answering 202 when the notification fails', async () => {
    vi.mocked(notifier.notifyContactMessage).mockRejectedValueOnce(new Error('webhook down'));

    expect((await submit()).statusCode).toBe(202);
  });

  it('cleans up windows older than one hour', async () => {
    await ctx.pool.query(`
      INSERT INTO rate_limits (key, window_start, count) VALUES
        ('contact:global', now() - interval '2 hours', 3),
        ('contact:global', now() - interval '10 minutes', 3)`);

    expect(await deleteStaleRateLimits(ctx.pool)).toBe(1);
    expect((await ctx.pool.query('SELECT 1 FROM rate_limits')).rowCount).toBe(1);
  });
});
