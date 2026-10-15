import type { Pool, PoolClient } from 'pg';

type Queryable = PoolClient | Pool;

export interface OtpRow {
  code_hash: string;
  expires_at: Date;
  attempts_left: number;
  last_requested_at: Date;
}

export async function lockOtp(client: PoolClient, emailHash: string): Promise<OtpRow | null> {
  const result = await client.query<OtpRow>(
    'SELECT code_hash, expires_at, attempts_left, last_requested_at FROM otp_codes WHERE email_hash = $1 FOR UPDATE',
    [emailHash],
  );
  return result.rows[0] ?? null;
}

/** ขอรหัสใหม่ = เขียนทับรหัสเดิม (รหัสเก่าใช้ไม่ได้ทันที) */
export async function saveOtp(
  client: PoolClient,
  otp: { emailHash: string; codeHash: string; expiresAt: Date; attempts: number; requestedAt: Date },
): Promise<void> {
  await client.query(
    `INSERT INTO otp_codes (email_hash, code_hash, expires_at, attempts_left, last_requested_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email_hash) DO UPDATE SET
       code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
       attempts_left = EXCLUDED.attempts_left, last_requested_at = EXCLUDED.last_requested_at`,
    [otp.emailHash, otp.codeHash, otp.expiresAt, otp.attempts, otp.requestedAt],
  );
}

export async function setAttemptsLeft(client: PoolClient, emailHash: string, attemptsLeft: number): Promise<void> {
  await client.query('UPDATE otp_codes SET attempts_left = $2 WHERE email_hash = $1', [emailHash, attemptsLeft]);
}

export async function deleteOtps(db: Queryable, emailHashes: string[]): Promise<void> {
  if (emailHashes.length === 0) return;
  await db.query('DELETE FROM otp_codes WHERE email_hash = ANY($1::text[])', [emailHashes]);
}
