import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';

const JANITOR_INTERVAL_MS = 10 * 60 * 1000;

/** ลบตัวนับที่หน้าต่างจบไปนานกว่า 1 ชั่วโมง; คืนจำนวนแถวที่ลบ */
export async function deleteStaleRateLimits(pool: Pool): Promise<number> {
  const result = await pool.query("DELETE FROM rate_limits WHERE window_start < now() - interval '1 hour'");
  return result.rowCount ?? 0;
}

/** ลบรหัส OTP ที่หมดอายุเกิน 1 ชั่วโมง (เก็บไว้ช่วงหนึ่งเพื่อยังนับ cooldown ได้); คืนจำนวนแถวที่ลบ */
export async function deleteExpiredOtpCodes(pool: Pool): Promise<number> {
  const result = await pool.query("DELETE FROM otp_codes WHERE expires_at < now() - interval '1 hour'");
  return result.rowCount ?? 0;
}

/** งานเบื้องหลังลบตัวนับเก่าและรหัส OTP ที่หมดอายุทุก 10 นาที — คืนฟังก์ชันหยุดงาน */
export function startRateLimitJanitor(
  pool: Pool,
  log: FastifyBaseLogger,
  intervalMs = JANITOR_INTERVAL_MS,
): () => void {
  const timer = setInterval(() => {
    deleteStaleRateLimits(pool).then(
      (deleted) => {
        if (deleted > 0) log.info({ deleted }, 'stale rate limit windows removed');
      },
      (error: unknown) => log.warn({ err: error }, 'rate limit cleanup failed'),
    );
    deleteExpiredOtpCodes(pool).then(
      (deleted) => {
        if (deleted > 0) log.info({ deleted }, 'expired otp codes removed');
      },
      (error: unknown) => log.warn({ err: error }, 'otp cleanup failed'),
    );
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
