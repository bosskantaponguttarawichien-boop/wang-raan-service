import type { Pool, PoolClient } from 'pg';
import type { StoreLayout, ValidationResult } from '@bosskantaponguttarawichien-boop/wang-raan-core';
import type { LayoutSummary, StoredLayout } from './layouts.schemas.js';

type Queryable = Pool | PoolClient;

interface LayoutRow {
  id: string;
  layout: StoreLayout;
  validation: ValidationResult;
  created_at: Date;
  updated_at: Date;
}

export function toStoredLayout(row: LayoutRow): StoredLayout {
  return {
    layout: row.layout,
    validation: row.validation,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const COLUMNS = 'id, layout, validation, created_at, updated_at';

export async function listLayoutSummaries(db: Queryable, ownerId: string): Promise<LayoutSummary[]> {
  const result = await db.query<{
    id: string;
    width: number;
    depth: number;
    object_count: number;
    status: ValidationResult['status'];
    updated_at: Date;
  }>(
    `SELECT id,
            (layout->>'width')::float8 AS width,
            (layout->>'depth')::float8 AS depth,
            jsonb_array_length(layout->'objects') AS object_count,
            validation->>'status' AS status,
            updated_at
       FROM layouts
      WHERE owner_id = $1
      ORDER BY updated_at DESC, id`,
    [ownerId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    width: row.width,
    depth: row.depth,
    objectCount: row.object_count,
    status: row.status,
    updatedAt: row.updated_at.toISOString(),
  }));
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
): Promise<StoredLayout> {
  const result = await db.query<LayoutRow>(
    `INSERT INTO layouts (owner_id, id, layout, validation)
     VALUES ($1, $2, $3::jsonb, $4::jsonb)
     RETURNING ${COLUMNS}`,
    [ownerId, layout.id, JSON.stringify(layout), JSON.stringify(validation)],
  );
  return toStoredLayout(result.rows[0] as LayoutRow);
}

export async function updateLayout(
  db: Queryable,
  ownerId: string,
  layout: StoreLayout,
  validation: ValidationResult,
): Promise<StoredLayout | null> {
  const result = await db.query<LayoutRow>(
    `UPDATE layouts
        SET layout = $3::jsonb, validation = $4::jsonb, updated_at = now()
      WHERE owner_id = $1 AND id = $2
      RETURNING ${COLUMNS}`,
    [ownerId, layout.id, JSON.stringify(layout), JSON.stringify(validation)],
  );
  const row = result.rows[0];
  return row ? toStoredLayout(row) : null;
}

export async function deleteLayout(db: Queryable, ownerId: string, layoutId: string): Promise<boolean> {
  const result = await db.query('DELETE FROM layouts WHERE owner_id = $1 AND id = $2', [ownerId, layoutId]);
  return (result.rowCount ?? 0) > 0;
}
