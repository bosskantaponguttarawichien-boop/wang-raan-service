import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { OtpMailer } from '../../src/services/mailer.js';
import { createTestContext } from './harness.js';
import type { TestContext } from './harness.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const IP = '203.0.113.7';

/** mailer ที่จำรหัสล่าสุดต่ออีเมลไว้ (แทนการส่งเมลจริง) */
function captureMailer() {
  const codes = new Map<string, string>();
  let fail = false;
  const mailer: OtpMailer = {
    async sendOtp(email, code) {
      if (fail) throw new Error('provider down');
      codes.set(email, code);
    },
  };
  return { mailer, codes, failNext: (value: boolean) => (fail = value) };
}

describe('identities + email OTP (PostgreSQL)', () => {
  let ctx: TestContext;
  let clock = new Date('2026-10-15T03:00:00.000Z');
  const mail = captureMailer();

  beforeAll(async () => {
    ctx = await createTestContext({ mailer: mail.mailer, clock: () => clock });
  });
  beforeEach(async () => {
    await ctx.reset();
    clock = new Date('2026-10-15T03:00:00.000Z');
    mail.codes.clear();
    mail.failNext(false);
  });
  afterAll(async () => {
    await ctx.close();
  });

  const post = (url: string, payload: unknown, headers: Record<string, string> = { 'x-client-ip': IP }) =>
    ctx.as('anonymous', { method: 'POST', url, payload: payload as object, headers });
  const resolve = (payload: unknown) => post('/v1/auth/identities/resolve', payload);
  const google = (id: string, email: string | null, emailVerified = true, extra: object = {}) =>
    resolve({ provider: 'google', providerAccountId: id, email, emailVerified, ...extra });
  const requestOtp = (email: string) => post('/v1/auth/otp/request', { email });
  const verifyOtp = (email: string, code: string) => post('/v1/auth/otp/verify', { email, code });
  /** ขอรหัสแล้วตรวจด้วยรหัสที่ส่งไป — เลื่อนนาฬิกาพ้น cooldown ให้การเรียกครั้งถัดไป */
  async function otpLogin(email: string) {
    expect((await requestOtp(email)).statusCode).toBe(200);
    const response = await verifyOtp(email, mail.codes.get(email.trim().toLowerCase())!);
    clock = new Date(clock.getTime() + 61_000);
    return response;
  }
  const count = async (sql: string, params: unknown[] = []) =>
    (await ctx.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, params)).rows[0]?.n;

  describe('POST /v1/auth/identities/resolve', () => {
    it('creates a new guest-<uuid> every time, without an identity, and requires X-Client-IP', async () => {
      const a = await resolve({ provider: 'guest' });
      const b = await resolve({ provider: 'guest' });

      expect(a.statusCode).toBe(200);
      expect(a.json()).toEqual({ user: expect.objectContaining({ provider: 'guest', email: null }), created: true });
      expect(a.json().user.id).toMatch(new RegExp(`^guest-${UUID}$`));
      expect(b.json().user.id).not.toBe(a.json().user.id);
      expect(await count('identities')).toBe(0);
      expect((await post('/v1/auth/identities/resolve', { provider: 'guest' }, {})).statusCode).toBe(400);
    });

    it('rate limits guest creation per X-Client-IP (429 + Retry-After)', async () => {
      for (let i = 0; i < 30; i += 1) expect((await resolve({ provider: 'guest' })).statusCode).toBe(200);
      const limited = await resolve({ provider: 'guest' });

      expect(limited.statusCode).toBe(429);
      expect(limited.headers['retry-after']).toBeDefined();
      expect(await count("users WHERE provider = 'guest'")).toBe(30);
    });

    it('creates usr-<uuid> on first login and returns the same account afterwards', async () => {
      const first = await google('g-1', 'alice@example.com', true, {
        name: 'Alice',
        image: 'https://img.example/a.png',
      });
      const second = await google('g-1', 'alice@example.com');

      expect(first.json()).toMatchObject({
        created: true,
        user: { provider: 'google', name: 'Alice', email: 'alice@example.com' },
      });
      expect(first.json().user.id).toMatch(new RegExp(`^usr-${UUID}$`));
      expect(second.json()).toMatchObject({ created: false, user: { id: first.json().user.id } });
    });

    it('keeps legacy <provider>-<id> users on their old id (backfilled identity)', async () => {
      await ctx.pool.query("INSERT INTO users (id, provider) VALUES ('google-1234', 'google')");
      await ctx.pool.query(
        "INSERT INTO identities (provider, provider_account_id, user_id) VALUES ('google', '1234', 'google-1234')",
      );

      expect((await google('1234', 'old@example.com')).json()).toMatchObject({
        created: false,
        user: { id: 'google-1234' },
      });
    });

    it('links a verified Google login to an existing OTP account with the same email', async () => {
      const otp = (await otpLogin('alice@example.com')).json();
      const linked = await google('g-1', 'ALICE@Example.com');

      expect(linked.json()).toMatchObject({ created: false, user: { id: otp.user.id, provider: 'google' } });
      expect((await otpLogin('alice@example.com')).json().user).toMatchObject({ id: otp.user.id, provider: 'email' });
    });

    it('links an OTP login to an existing verified Google account', async () => {
      const g = (await google('g-1', 'alice@example.com')).json();
      expect((await otpLogin('alice@example.com')).json()).toMatchObject({ created: false, user: { id: g.user.id } });
    });

    it('does not link an unverified Google email', async () => {
      const otp = (await otpLogin('alice@example.com')).json();
      const g = (await google('g-1', 'alice@example.com', false)).json();

      expect(g.created).toBe(true);
      expect(g.user.id).not.toBe(otp.user.id);
    });

    it('never links GitHub/LINE by email in either direction', async () => {
      const otp = (await otpLogin('alice@example.com')).json();
      const gh = await resolve({
        provider: 'github',
        providerAccountId: '42',
        email: 'alice@example.com',
        emailVerified: true,
      });
      expect(gh.json().user.id).not.toBe(otp.user.id);

      const squatter = await resolve({
        provider: 'line',
        providerAccountId: 'U1',
        email: 'carol@example.com',
        emailVerified: true,
      });
      expect((await otpLogin('carol@example.com')).json().user.id).not.toBe(squatter.json().user.id);
    });

    it('keeps the account when the email changes at Google (identity first)', async () => {
      const before = (await google('g-1', 'alice@example.com')).json();
      const after = (await google('g-1', 'alice.new@example.com')).json();

      expect(after).toMatchObject({ created: false, user: { id: before.user.id } });
      expect(await count("identities WHERE email = 'alice.new@example.com'")).toBe(1);
    });

    it('records the last login provider but never overwrites profile fields the user set', async () => {
      const { user } = (await google('g-1', 'alice@example.com', true, { name: 'Alice' })).json();
      await ctx.as(user.id, { method: 'PUT', url: '/v1/me', payload: { name: 'ร้านของอลิซ' } });

      const again = (await google('g-1', 'alice@example.com', true, { name: 'Alice G.' })).json();
      expect(again.user).toMatchObject({ provider: 'google', name: 'ร้านของอลิซ' });
    });

    it('creates exactly one account when the same first login races', async () => {
      const results = await Promise.all(Array.from({ length: 5 }, () => google('g-race', 'race@example.com')));

      expect(new Set(results.map((r) => r.json().user.id)).size).toBe(1);
      expect(await count('users')).toBe(1);
    });

    it('rejects provider email (OTP only) and malformed bodies with 400', async () => {
      const cases = [
        { provider: 'email', providerAccountId: 'a@example.com', email: 'a@example.com', emailVerified: true },
        { provider: 'google', providerAccountId: '', email: null, emailVerified: false },
        { provider: 'google', providerAccountId: 'x', email: null },
        { provider: 'guest', providerAccountId: 'x' },
        { provider: 'facebook', providerAccountId: 'x', email: null, emailVerified: false },
      ];
      for (const payload of cases) {
        const response = await resolve(payload);
        expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      }
      expect(await count('users')).toBe(0);
    });
  });

  describe('email OTP', () => {
    it('answers the same for any email, stores only hashes, and creates usr-<uuid> on first verify', async () => {
      const response = await requestOtp('New@Example.com');
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ sent: true, expiresIn: 600 });

      const code = mail.codes.get('new@example.com')!;
      expect(code).toMatch(/^\d{6}$/);
      const rows = (await ctx.pool.query('SELECT * FROM otp_codes')).rows;
      expect(JSON.stringify(rows)).not.toContain(code);
      expect(JSON.stringify(rows)).not.toContain('new@example.com');

      const verified = await verifyOtp('new@example.com', code);
      expect(verified.json()).toMatchObject({ created: true, user: { provider: 'email', email: 'new@example.com' } });
      expect(verified.json().user.id).toMatch(new RegExp(`^usr-${UUID}$`));
      // ใช้ได้ครั้งเดียว
      expect((await verifyOtp('new@example.com', code)).json().error.code).toBe('OTP_EXPIRED');
    });

    it('enforces a 60 s cooldown per email with Retry-After, then a per-email cap', async () => {
      await requestOtp('a@example.com');
      clock = new Date(clock.getTime() + 20_000);
      const early = await requestOtp('a@example.com');
      expect(early.statusCode).toBe(429);
      expect(early.headers['retry-after']).toBe('40');
      expect(early.json().error).toMatchObject({ code: 'RATE_LIMITED', retryAfter: 40 });

      for (let i = 0; i < 4; i += 1) {
        clock = new Date(clock.getTime() + 61_000);
        expect((await requestOtp('a@example.com')).statusCode).toBe(200);
      }
      clock = new Date(clock.getTime() + 61_000);
      expect((await requestOtp('a@example.com')).statusCode).toBe(429);
    });

    it('a new code invalidates the previous one', async () => {
      await requestOtp('a@example.com');
      const old = mail.codes.get('a@example.com')!;
      clock = new Date(clock.getTime() + 61_000);
      await requestOtp('a@example.com');
      const fresh = mail.codes.get('a@example.com')!;

      if (old !== fresh) expect((await verifyOtp('a@example.com', old)).json().error.code).toBe('OTP_INVALID');
      expect((await verifyOtp('a@example.com', fresh)).statusCode).toBe(200);
    });

    it('counts wrong codes even though the request fails, then locks after 5', async () => {
      await requestOtp('a@example.com');
      const code = mail.codes.get('a@example.com')!;
      const wrong = code === '000000' ? '111111' : '000000';

      const first = await verifyOtp('a@example.com', wrong);
      expect(first.statusCode).toBe(400);
      expect(first.json().error).toMatchObject({ code: 'OTP_INVALID', attemptsLeft: 4 });
      for (const left of [3, 2, 1]) {
        expect((await verifyOtp('a@example.com', wrong)).json().error.attemptsLeft).toBe(left);
      }
      expect((await verifyOtp('a@example.com', wrong)).json().error.code).toBe('OTP_ATTEMPTS_EXCEEDED');
      expect((await verifyOtp('a@example.com', code)).json().error.code).toBe('OTP_ATTEMPTS_EXCEEDED');
    });

    it('expires codes after 10 minutes', async () => {
      await requestOtp('a@example.com');
      clock = new Date(clock.getTime() + 601_000);
      expect((await verifyOtp('a@example.com', mail.codes.get('a@example.com')!)).json().error.code).toBe(
        'OTP_EXPIRED',
      );
    });

    it('answers 503 when the mail provider fails (the cooldown still applies)', async () => {
      mail.failNext(true);
      const response = await requestOtp('a@example.com');
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe('INTERNAL_ERROR');
    });

    it('rate limits verify attempts per IP across emails', async () => {
      for (let i = 0; i < 30; i += 1) await verifyOtp(`x${i}@example.com`, '123456');
      const limited = await verifyOtp('y@example.com', '123456');
      expect(limited.statusCode).toBe(429);
    });
  });

  it('answers 503 at otp/request in production without a mail provider', async () => {
    const prod = await createTestContext({ mailer: null });
    try {
      const response = await prod.as('anonymous', {
        method: 'POST',
        url: '/v1/auth/otp/request',
        payload: { email: 'a@example.com' },
        headers: { 'x-client-ip': IP },
      });
      expect(response.statusCode).toBe(503);
    } finally {
      await prod.close();
    }
  });

  it('Guest → OTP login → merge-guest moves every layout into the new account', async () => {
    const guest = (await resolve({ provider: 'guest' })).json().user.id;
    const { readyLayout } = await import('../helpers/layouts.js');
    await ctx.as(guest, { method: 'POST', url: '/v1/layouts', payload: { layout: readyLayout('a') } });
    await ctx.as(guest, { method: 'POST', url: '/v1/layouts', payload: { layout: readyLayout('b') } });
    const user = (await otpLogin('dave@example.com')).json().user.id;

    const merged = await ctx.as(user, { method: 'POST', url: '/v1/me/merge-guest', payload: { guestId: guest } });
    expect(merged.json()).toMatchObject({ movedLayouts: 2 });
    expect((await ctx.as(user, { url: '/v1/layouts' })).json().layouts).toHaveLength(2);
  });
});
