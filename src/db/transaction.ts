import type { Pool, PoolClient } from 'pg';

/**
 * รัน `work` ใน transaction เดียว — commit เมื่อสำเร็จ, rollback เมื่อโยน error
 * (รวมถึง AppError ที่ตั้งใจโยนเพื่อยกเลิกงาน เช่น เกินโควตา)
 */
export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** ล็อกระดับผู้ใช้จนจบ transaction — ใช้กันการเช็กโควตาแล้ว insert ซ้อนกัน */
export async function lockUser(client: PoolClient, userId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('user:' || $1, 0))", [userId]);
}
