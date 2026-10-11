import type { Pool } from 'pg';

/** ส่วนของ pg Pool ที่ health check ใช้ — แยกออกมาเพื่อให้ทดสอบด้วย fake ได้ */
export type DatabaseProbeTarget = Pick<Pool, 'query'>;

export const DATABASE_PROBE_TIMEOUT_MS = 2000;

/** ตรงกับ `components.schemas.Health` ใน contracts/openapi.yaml */
export interface HealthReport {
  status: 'ok' | 'degraded';
  version: string;
  database: 'ok' | 'unavailable';
}

/**
 * ยิง `SELECT 1` พร้อมเพดานเวลา — pg ไม่มี connect timeout ค่าเริ่มต้น
 * ถ้าไม่จำกัดเวลา health check จะค้างตอนฐานข้อมูลล่ม แทนที่จะตอบ 503
 */
export async function probeDatabase(
  database: DatabaseProbeTarget,
  timeoutMs = DATABASE_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`database probe timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    await Promise.race([database.query('SELECT 1'), timeout]);
    return true;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkHealth(
  database: DatabaseProbeTarget | undefined,
  version: string,
  onProbeError: (error: unknown) => void,
  timeoutMs?: number,
): Promise<HealthReport> {
  let databaseOk = false;

  if (database) {
    try {
      databaseOk = await probeDatabase(database, timeoutMs);
    } catch (error) {
      onProbeError(error);
    }
  }

  return databaseOk
    ? { status: 'ok', version, database: 'ok' }
    : { status: 'degraded', version, database: 'unavailable' };
}
