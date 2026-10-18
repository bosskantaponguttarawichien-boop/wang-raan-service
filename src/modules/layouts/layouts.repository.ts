import type { Pool, PoolClient } from 'pg';
import { migrateLayout } from '@bosskantaponguttarawichien-boop/wang-raan-core';
import type { StoreLayout, ValidationResult } from '@bosskantaponguttarawichien-boop/wang-raan-core';
import type { LayoutSummary, StoredLayout } from './layouts.schemas.js';

type Queryable = Pool | PoolClient;

interface LayoutRow {
  id: string;
  name: string;
  layout: StoreLayout;
  validation: ValidationResult;
  created_at: Date;
  updated_at: Date;
}

export function toStoredLayout(row: LayoutRow): StoredLayout {
  return {
    name: row.name,
    // ผังที่บันทึกด้วย core 1.x (ครัวเป็นกล่องบนพื้น) → รูปแบบปัจจุบัน (kitchenDoor) ก่อนส่งออก
    layout: migrateLayout(row.layout),
    validation: row.validation,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const COLUMNS = 'id, name, layout, validation, created_at, updated_at';

/** ตำแหน่งในลำดับ `updated_at DESC, id ASC` — updated_at เก็บเป็น microsecond จาก epoch (Date ของ JS ละเอียดแค่ ms) */
export interface PagePosition {
  updatedAtMicros: string;
  id: string;
}

/**
 * รายการผังทีละหน้า (keyset) — อ่านเกิน 1 แถวเพื่อรู้ว่ามีหน้าถัดไปไหม
 * `after` = แถวสุดท้ายของหน้าก่อน; คืน `next` เมื่อยังมีแถวเหลือ
 */
export async function listLayoutSummaries(
  db: Queryable,
  ownerId: string,
  page: { limit: number; after?: PagePosition | undefined },
): Promise<{ layouts: LayoutSummary[]; next: PagePosition | null }> {
  const params: unknown[] = [ownerId, page.limit + 1];
  let where = 'owner_id = $1';
  if (page.after) {
    params.push(page.after.updatedAtMicros, page.after.id);
    where += ` AND (updated_at < timestamptz 'epoch' + $3::bigint * interval '1 microsecond'
                OR (updated_at = timestamptz 'epoch' + $3::bigint * interval '1 microsecond' AND id > $4))`;
  }
  const result = await db.query<{
    id: string;
    name: string;
    layout: StoreLayout;
    object_count: number;
    status: ValidationResult['status'];
    updated_at: Date;
    updated_us: string;
  }>(
    `SELECT id, name, layout,
            jsonb_array_length(layout->'objects') AS object_count,
            validation->>'status' AS status,
            updated_at,
            (extract(epoch FROM updated_at) * 1000000)::bigint::text AS updated_us
       FROM layouts
      WHERE ${where}
      ORDER BY updated_at DESC, id
      LIMIT $2`,
    params,
  );

  const rows = result.rows.slice(0, page.limit);
  const last = rows[rows.length - 1];
  return {
    layouts: rows.map((row) => {
      const layout = migrateLayout(row.layout);
      return {
        id: row.id,
        name: row.name,
        width: layout.width,
        depth: layout.depth,
        objectCount: layout === row.layout ? row.object_count : layout.objects.length,
        status: row.status,
        updatedAt: row.updated_at.toISOString(),
        layout,
      };
    }),
    next: result.rows.length > page.limit && last ? { updatedAtMicros: last.updated_us, id: last.id } : null,
  };
}

export async function findLayout(
  db: Queryable,
  ownerId: string,
  layoutId: string,
  options: { forUpdate?: boolean } = {},
): Promise<StoredLayout | null> {
  const result = await db.query<LayoutRow>(
    `SELECT ${COLUMNS} FROM layouts WHERE owner_id = $1 AND id = $2${options.forUpdate ? ' FOR UPDATE' : ''}`,
    [ownerId, layoutId],
  );
  const row = result.rows[0];
  return row ? toStoredLayout(row) : null;
}

export async function listStoredLayouts(db: Queryable, ownerId: string): Promise<StoredLayout[]> {
  const result = await db.query<LayoutRow>(
    `SELECT ${COLUMNS} FROM layouts WHERE owner_id = $1 ORDER BY updated_at DESC, id`,
    [ownerId],
  );
  return result.rows.map(toStoredLayout);
}

export async function countLayouts(db: Queryable, ownerId: string): Promise<number> {
  const result = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM layouts WHERE owner_id = $1', [
    ownerId,
  ]);
  return result.rows[0]?.count ?? 0;
}

export async function insertLayout(
  db: Queryable,
  ownerId: string,
  layout: StoreLayout,
  validation: ValidationResult,
  name: string,
): Promise<StoredLayout> {
  const result = await db.query<LayoutRow>(
    `INSERT INTO layouts (owner_id, id, name, layout, validation)
     VALUES ($1, $2, $5, $3::jsonb, $4::jsonb)
     RETURNING ${COLUMNS}`,
    [ownerId, layout.id, JSON.stringify(layout), JSON.stringify(validation), name],
  );
  return toStoredLayout(result.rows[0] as LayoutRow);
}

/** `name` ไม่ส่ง (undefined) = คงชื่อเดิม */
export async function updateLayout(
  db: Queryable,
  ownerId: string,
  layout: StoreLayout,
  validation: ValidationResult,
  name?: string,
): Promise<StoredLayout | null> {
  const result = await db.query<LayoutRow>(
    `UPDATE layouts
        SET layout = $3::jsonb, validation = $4::jsonb, name = COALESCE($5, name), updated_at = now()
      WHERE owner_id = $1 AND id = $2
      RETURNING ${COLUMNS}`,
    [ownerId, layout.id, JSON.stringify(layout), JSON.stringify(validation), name ?? null],
  );
  const row = result.rows[0];
  return row ? toStoredLayout(row) : null;
}

export async function deleteLayout(db: Queryable, ownerId: string, layoutId: string): Promise<boolean> {
  const result = await db.query('DELETE FROM layouts WHERE owner_id = $1 AND id = $2', [ownerId, layoutId]);
  return (result.rowCount ?? 0) > 0;
}

export async function listLayoutIds(db: Queryable, ownerId: string): Promise<string[]> {
  const result = await db.query<{ id: string }>('SELECT id FROM layouts WHERE owner_id = $1', [ownerId]);
  return result.rows.map((row) => row.id);
}

/** ล็อกและอ่านผังทั้งหมดของเจ้าของ — ใช้ตอนย้ายผัง Guest */
export async function lockLayoutsOfOwner(db: Queryable, ownerId: string): Promise<StoredLayout[]> {
  const result = await db.query<LayoutRow>(
    `SELECT ${COLUMNS} FROM layouts WHERE owner_id = $1 ORDER BY id FOR UPDATE`,
    [ownerId],
  );
  return result.rows.map(toStoredLayout);
}

/** ย้ายผังไปยังเจ้าของใหม่ (เปลี่ยน id ได้) โดยคง created_at/updated_at เดิม */
export async function moveLayout(
  db: Queryable,
  move: { fromOwner: string; fromId: string; toOwner: string; layout: StoreLayout; validation: ValidationResult },
): Promise<void> {
  await db.query(
    `UPDATE layouts SET owner_id = $3, id = $4, layout = $5::jsonb, validation = $6::jsonb
      WHERE owner_id = $1 AND id = $2`,
    [
      move.fromOwner,
      move.fromId,
      move.toOwner,
      move.layout.id,
      JSON.stringify(move.layout),
      JSON.stringify(move.validation),
    ],
  );
}
