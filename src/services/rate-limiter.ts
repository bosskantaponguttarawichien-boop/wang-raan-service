import type { PoolClient } from 'pg';

export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export interface RateLimitRule {
  key: string;
  limit: number;
}

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfter: number };

/** ต้นหน้าต่าง fixed window 10 นาที (ตัดตาม epoch — ตรงกับนาที :00, :10, :20 … UTC) */
export function windowStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS);
}

/** วินาทีที่เหลือจนจบหน้าต่างปัจจุบัน (อย่างน้อย 1 ตามสัญญา) */
export function secondsUntilWindowEnds(now: Date): number {
  const end = windowStart(now).getTime() + RATE_LIMIT_WINDOW_MS;
  return Math.max(1, Math.ceil((end - now.getTime()) / 1000));
}

/**
 * นับคำขอทุก rule ใน transaction ของผู้เรียก — ถ้า rule ใดเกิน ผู้เรียกต้อง rollback
 * เพื่อไม่ให้คำขอที่ถูกปฏิเสธกินโควตา (upsert ล็อกแถวจน transaction จบ จึงนับถูกแม้มีคำขอพร้อมกัน)
 */
export async function consumeRateLimits(
  client: PoolClient,
  rules: RateLimitRule[],
  now: Date,
): Promise<RateLimitDecision> {
  const start = windowStart(now);
  let exceeded = false;

  // ล็อกตามลำดับ key เสมอ — กัน deadlock ระหว่างคำขอที่ใช้ key ชุดเดียวกัน
  for (const rule of [...rules].sort((a, b) => a.key.localeCompare(b.key))) {
    const result = await client.query<{ count: number }>(
      `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2, 1)
       ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
       RETURNING count`,
      [rule.key, start],
    );
    if ((result.rows[0]?.count ?? 0) > rule.limit) exceeded = true;
  }

  return exceeded ? { allowed: false, retryAfter: secondsUntilWindowEnds(now) } : { allowed: true };
}
