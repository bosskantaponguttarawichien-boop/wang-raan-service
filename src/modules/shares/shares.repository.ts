import type { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;

/** ยกเลิกลิงก์ที่ยัง active ของผัง (ตั้ง `revoked_at` — ไม่ลบแถว เพื่อให้หน้าแชร์ตอบ 410 ได้) */
export async function revokeSharesForLayout(db: Queryable, ownerId: string, layoutId: string): Promise<number> {
  const result = await db.query(
    'UPDATE share_links SET revoked_at = now() WHERE owner_id = $1 AND layout_id = $2 AND revoked_at IS NULL',
    [ownerId, layoutId],
  );
  return result.rowCount ?? 0;
}
