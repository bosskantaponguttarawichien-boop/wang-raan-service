import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';

const JANITOR_INTERVAL_MS = 10 * 60 * 1000;

/** ลบตัวนับที่หน้าต่างจบไปนานกว่า 1 ชั่วโมง; คืนจำนวนแถวที่ลบ */
export async function deleteStaleRateLimits(pool: Pool): Promise<number> {
  const result = await pool.query("DELETE FROM rate_limits WHERE window_start < now() - interval '1 hour'");
  return result.rowCount ?? 0;
}

/** งานเบื้องหลังลบตัวนับเก่าทุก 10 นาที — คืนฟังก์ชันหยุดงาน */
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
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
