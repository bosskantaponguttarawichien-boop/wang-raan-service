import type { Pool, PoolClient } from 'pg';
import type { StoreLayout, ValidationResult } from '@bosskantaponguttarawichien-boop/wang-raan-core';
import { shareStatus } from './shares.schemas.js';
import type { ShareLink } from './shares.schemas.js';

type Queryable = Pool | PoolClient;

export interface ShareRow {
  share_key: string;
  layout_id: string;
  created_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
}

/** แถวสำหรับหน้าแชร์สาธารณะ — ไม่ SELECT `owner_id` ตั้งแต่ระดับ SQL */
export interface PublicShareRow {
  layout: StoreLayout;
  validation: ValidationResult;
  created_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
}

const SHARE_COLUMNS = 'share_key, layout_id, created_at, expires_at, revoked_at';

export function toShareLink(row: ShareRow, now = new Date()): ShareLink {
  return {
    shareKey: row.share_key,
    layoutId: row.layout_id,
    status: shareStatus({ expiresAt: row.expires_at, revokedAt: row.revoked_at }, now),
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
  };
}

/** ยกเลิกลิงก์ที่ยัง active ของผัง (ตั้ง `revoked_at` — ไม่ลบแถว เพื่อให้หน้าแชร์ตอบ 410 ได้) */
export async function revokeSharesForLayout(db: Queryable, ownerId: string, layoutId: string): Promise<number> {
  const result = await db.query(
    'UPDATE share_links SET revoked_at = now() WHERE owner_id = $1 AND layout_id = $2 AND revoked_at IS NULL',
    [ownerId, layoutId],
  );
  return result.rowCount ?? 0;
}

export async function listSharesForLayout(db: Queryable, ownerId: string, layoutId: string): Promise<ShareRow[]> {
  const result = await db.query<ShareRow>(
    `SELECT ${SHARE_COLUMNS} FROM share_links
      WHERE owner_id = $1 AND layout_id = $2
      ORDER BY created_at DESC, share_key`,
    [ownerId, layoutId],
  );
  return result.rows;
}

export async function listSharesForOwner(db: Queryable, ownerId: string): Promise<ShareRow[]> {
  const result = await db.query<ShareRow>(
    `SELECT ${SHARE_COLUMNS} FROM share_links WHERE owner_id = $1 ORDER BY created_at DESC, share_key`,
    [ownerId],
  );
  return result.rows;
}

export async function countActiveShares(db: Queryable, ownerId: string, layoutId: string): Promise<number> {
  const result = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM share_links
      WHERE owner_id = $1 AND layout_id = $2
        AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    [ownerId, layoutId],
  );
  return result.rows[0]?.count ?? 0;
}

export async function insertShare(
  db: Queryable,
  share: {
    shareKey: string;
    ownerId: string;
    layoutId: string;
    layout: StoreLayout;
    validation: ValidationResult;
    expiresAt: Date | null;
  },
): Promise<ShareRow> {
  const result = await db.query<ShareRow>(
    `INSERT INTO share_links (share_key, owner_id, layout_id, layout, validation, expires_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
     RETURNING ${SHARE_COLUMNS}`,
    [
      share.shareKey,
      share.ownerId,
      share.layoutId,
      JSON.stringify(share.layout),
      JSON.stringify(share.validation),
      share.expiresAt,
    ],
  );
  return result.rows[0] as ShareRow;
}

export async function findOwnedShare(
  db: Queryable,
  ownerId: string,
  shareKey: string,
  options: { forUpdate?: boolean } = {},
): Promise<ShareRow | null> {
  const result = await db.query<ShareRow>(
    `SELECT ${SHARE_COLUMNS} FROM share_links
      WHERE share_key = $1 AND owner_id = $2${options.forUpdate ? ' FOR UPDATE' : ''}`,
    [shareKey, ownerId],
  );
  return result.rows[0] ?? null;
}

export async function updateShareExpiry(
  db: Queryable,
  ownerId: string,
  shareKey: string,
  expiresAt: Date | null,
): Promise<ShareRow> {
  const result = await db.query<ShareRow>(
    `UPDATE share_links SET expires_at = $3 WHERE share_key = $1 AND owner_id = $2 RETURNING ${SHARE_COLUMNS}`,
    [shareKey, ownerId, expiresAt],
  );
  return result.rows[0] as ShareRow;
}

/** ตั้ง `revoked_at` ครั้งแรกเท่านั้น (เรียกซ้ำได้); คืน false เมื่อไม่ใช่ลิงก์ของผู้ใช้นี้ */
export async function revokeShare(db: Queryable, ownerId: string, shareKey: string): Promise<boolean> {
  const result = await db.query(
    'UPDATE share_links SET revoked_at = COALESCE(revoked_at, now()) WHERE share_key = $1 AND owner_id = $2',
    [shareKey, ownerId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function findPublicShare(db: Queryable, shareKey: string): Promise<PublicShareRow | null> {
  const result = await db.query<PublicShareRow>(
    'SELECT layout, validation, created_at, expires_at, revoked_at FROM share_links WHERE share_key = $1',
    [shareKey],
  );
  return result.rows[0] ?? null;
}

/** ย้ายลิงก์ทั้งหมดไปเจ้าของใหม่ พร้อมเปลี่ยน layout_id ตามผังที่ถูกตั้งชื่อใหม่; คืนจำนวนลิงก์ที่ย้าย */
export async function moveShares(
  db: Queryable,
  fromOwner: string,
  toOwner: string,
  renamed: { from: string; to: string }[],
): Promise<number> {
  for (const { from, to } of renamed) {
    await db.query('UPDATE share_links SET layout_id = $3 WHERE owner_id = $1 AND layout_id = $2', [
      fromOwner,
      from,
      to,
    ]);
  }
  const result = await db.query('UPDATE share_links SET owner_id = $2 WHERE owner_id = $1', [fromOwner, toOwner]);
  return result.rowCount ?? 0;
}
