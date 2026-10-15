import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../../db/transaction.js';
import { AppError } from '../../middleware/errors.js';
import type { OtpMailer } from '../../services/mailer.js';
import { consumeRateLimits } from '../../services/rate-limiter.js';
import type { RateLimitRule } from '../../services/rate-limiter.js';
import { RequestOtpRequestSchema, ResolveIdentityRequestSchema, VerifyOtpRequestSchema } from './auth.schemas.js';
import type { IdentityInput, RequestOtpResponse, ResolvedUser } from './auth.schemas.js';
import { emailHash, normalizeEmail } from './email.js';
import * as identities from './identities.repository.js';
import * as otps from './otp.repository.js';

export const OTP_TTL_SECONDS = 600;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_COOLDOWN_SECONDS = 60;
/** ต่อหน้าต่าง rate limit 10 นาที (services/rate-limiter) */
export const AUTH_RATE_LIMITS = {
  /** ขอรหัสต่ออีเมล (นอกเหนือจาก cooldown 60 วินาที) */
  otpRequestPerEmail: 5,
  otpRequestPerIp: 20,
  /** ตรวจรหัสต่อ IP — กันไล่เดารหัสข้ามหลายอีเมล */
  otpVerifyPerIp: 30,
  guestPerIp: 30,
} as const;

/** provider ที่เชื่ออีเมลพอจะผูกบัญชีได้ */
const trustsEmail = (input: IdentityInput) =>
  input.emailVerified && (input.provider === 'google' || input.provider === 'email');

function requireClientIp(clientIp: string | null): string {
  if (clientIp === null) {
    throw new AppError(400, 'INVALID_REQUEST', 'X-Client-IP header is required', {
      details: [{ path: 'X-Client-IP', message: 'required (1-64 characters)' }],
    });
  }
  return clientIp;
}

const rateLimited = (retryAfter: number, message = 'too many requests, try again later') =>
  new AppError(429, 'RATE_LIMITED', message, { retryAfter });

/**
 * กติกาผูกบัญชี (สัญญา resolveIdentity) — ใช้ทั้ง OAuth และ OTP
 * 1. identity เดิม → บัญชีนั้น (ไม่ดูอีเมลอีก)
 * 2. อีเมลยืนยันแล้วทั้งสองฝั่ง (google/email) → บัญชีเดิมที่สร้างก่อนสุด
 * 3. ไม่เจอ → สร้าง `usr-<uuid>`
 */
export async function resolveIdentityInTransaction(client: PoolClient, input: IdentityInput): Promise<ResolvedUser> {
  const email = input.email === null ? null : normalizeEmail(input.email);
  await identities.lockKey(client, `identity:${input.provider}:${input.providerAccountId}`);
  if (email) await identities.lockKey(client, `email:${email}`);

  let user = await identities.findUserByIdentity(client, input.provider, input.providerAccountId);
  if (!user && email && trustsEmail(input)) user = await identities.findUserByVerifiedEmail(client, email);

  const created = !user;
  user ??= await identities.insertUser(client, {
    id: `usr-${randomUUID()}`,
    provider: input.provider,
    name: input.name,
    email,
    image: input.image,
  });
  await identities.upsertIdentity(client, {
    provider: input.provider,
    providerAccountId: input.providerAccountId,
    userId: user.id,
    email,
    emailVerified: input.emailVerified,
  });
  const updated = await identities.touchUserOnLogin(client, user.id, {
    provider: input.provider,
    name: input.name,
    email,
    image: input.image,
  });
  return { user: updated, created };
}

type VerifyOutcome =
  | { kind: 'ok'; resolved: ResolvedUser }
  | { kind: 'invalid'; attemptsLeft: number }
  | { kind: 'expired' }
  | { kind: 'exceeded' }
  | { kind: 'rate-limited'; retryAfter: number };

export class AuthService {
  private readonly codeKey: Buffer;

  constructor(
    private readonly pool: Pool,
    private readonly options: {
      secret: string;
      /** null = ยังไม่ได้ตั้งค่าบริการส่งเมล → otp/request ตอบ 503 */
      mailer: OtpMailer | null;
      /** รหัสคงที่สำหรับ E2E (นอก production เท่านั้น — ตรวจที่ config) */
      testCode?: string | null | undefined;
      now?: (() => Date) | undefined;
    },
  ) {
    this.codeKey = createHmac('sha256', options.secret).update('otp-code').digest();
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private codeHash(hashOfEmail: string, code: string): string {
    return createHmac('sha256', this.codeKey).update(`${hashOfEmail}:${code}`).digest('hex');
  }

  async resolve(clientIp: string | null, body: unknown): Promise<ResolvedUser> {
    const ip = requireClientIp(clientIp);
    const input = ResolveIdentityRequestSchema.parse(body);

    return withTransaction(this.pool, async (client) => {
      if (input.provider === 'guest') {
        const decision = await consumeRateLimits(
          client,
          [{ key: `guest:ip:${ip}`, limit: AUTH_RATE_LIMITS.guestPerIp }],
          this.now(),
        );
        if (!decision.allowed) throw rateLimited(decision.retryAfter, 'too many guest accounts from this address');
        const user = await identities.insertUser(client, { id: `guest-${randomUUID()}`, provider: 'guest' });
        return { user, created: true };
      }
      return resolveIdentityInTransaction(client, input);
    });
  }

  /** ตอบเหมือนกันทุกกรณี (ไม่บอกว่าอีเมลมีบัญชีไหม) — ห้าม log รหัสหรืออีเมล */
  async requestOtp(clientIp: string | null, body: unknown): Promise<RequestOtpResponse> {
    const ip = requireClientIp(clientIp);
    const email = normalizeEmail(RequestOtpRequestSchema.parse(body).email);
    const mailer = this.options.mailer;
    if (!mailer) throw new AppError(503, 'INTERNAL_ERROR', 'email delivery is not configured');

    const hashOfEmail = emailHash(email);
    const now = this.now();
    const code = this.options.testCode ?? String(randomInt(0, 1_000_000)).padStart(6, '0');

    await withTransaction(this.pool, async (client) => {
      const existing = await otps.lockOtp(client, hashOfEmail);
      const sinceLast = existing ? (now.getTime() - existing.last_requested_at.getTime()) / 1000 : Infinity;
      if (sinceLast < OTP_COOLDOWN_SECONDS) {
        throw rateLimited(
          Math.max(1, Math.ceil(OTP_COOLDOWN_SECONDS - sinceLast)),
          'please wait before requesting a new code',
        );
      }
      const rules: RateLimitRule[] = [
        { key: `otp:email:${hashOfEmail}`, limit: AUTH_RATE_LIMITS.otpRequestPerEmail },
        { key: `otp:ip:${ip}`, limit: AUTH_RATE_LIMITS.otpRequestPerIp },
      ];
      const decision = await consumeRateLimits(client, rules, now);
      if (!decision.allowed) throw rateLimited(decision.retryAfter);
      await otps.saveOtp(client, {
        emailHash: hashOfEmail,
        codeHash: this.codeHash(hashOfEmail, code),
        expiresAt: new Date(now.getTime() + OTP_TTL_SECONDS * 1000),
        attempts: OTP_MAX_ATTEMPTS,
        requestedAt: now,
      });
    });

    // ส่งหลัง commit — ส่งไม่สำเร็จตอบ 5XX ให้ผู้ใช้ขอใหม่ได้ (cooldown ยังนับ กันยิงเมลถี่)
    try {
      await mailer.sendOtp(email, code, OTP_TTL_SECONDS);
    } catch {
      throw new AppError(503, 'INTERNAL_ERROR', 'could not deliver the code, try again later');
    }
    return { sent: true, expiresIn: OTP_TTL_SECONDS };
  }

  async verifyOtp(clientIp: string | null, body: unknown): Promise<ResolvedUser> {
    const ip = requireClientIp(clientIp);
    const input = VerifyOtpRequestSchema.parse(body);
    const email = normalizeEmail(input.email);
    const hashOfEmail = emailHash(email);
    const now = this.now();

    // ไม่โยน error ใน transaction: การลดจำนวนครั้งที่เหลือ/ตัวนับ rate limit ต้อง commit แม้รหัสผิด
    const outcome = await withTransaction<VerifyOutcome>(this.pool, async (client) => {
      const decision = await consumeRateLimits(
        client,
        [{ key: `otp-verify:ip:${ip}`, limit: AUTH_RATE_LIMITS.otpVerifyPerIp }],
        now,
      );
      if (!decision.allowed) return { kind: 'rate-limited', retryAfter: decision.retryAfter };

      const otp = await otps.lockOtp(client, hashOfEmail);
      if (!otp || otp.expires_at.getTime() <= now.getTime()) return { kind: 'expired' };
      if (otp.attempts_left <= 0) return { kind: 'exceeded' };

      const expected = Buffer.from(otp.code_hash, 'hex');
      const given = Buffer.from(this.codeHash(hashOfEmail, input.code), 'hex');
      if (!timingSafeEqual(expected, given)) {
        const attemptsLeft = otp.attempts_left - 1;
        await otps.setAttemptsLeft(client, hashOfEmail, attemptsLeft);
        return attemptsLeft === 0 ? { kind: 'exceeded' } : { kind: 'invalid', attemptsLeft };
      }

      await otps.deleteOtps(client, [hashOfEmail]);
      const resolved = await resolveIdentityInTransaction(client, {
        provider: 'email',
        providerAccountId: email,
        email,
        emailVerified: true,
      });
      return { kind: 'ok', resolved };
    });

    switch (outcome.kind) {
      case 'ok':
        return outcome.resolved;
      case 'invalid':
        throw new AppError(400, 'OTP_INVALID', 'incorrect code', { attemptsLeft: outcome.attemptsLeft });
      case 'expired':
        throw new AppError(400, 'OTP_EXPIRED', 'code expired or not requested');
      case 'exceeded':
        throw new AppError(400, 'OTP_ATTEMPTS_EXCEEDED', 'too many incorrect attempts, request a new code');
      case 'rate-limited':
        throw rateLimited(outcome.retryAfter);
    }
  }
}
