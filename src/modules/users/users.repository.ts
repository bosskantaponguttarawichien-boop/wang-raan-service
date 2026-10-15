import type { Pool, PoolClient } from 'pg';
import { unauthorized } from '../../middleware/errors.js';
import type { AccountExport, UpdateProfileRequest, User } from './users.schemas.js';

export type AuthProvider = 'guest' | 'google' | 'line' | 'github' | 'email';

const LEGACY_USER_ID_PATTERN = /^(guest|google|line|github)-.+$/;

/**
 * provider จาก id รูปแบบเดิม `<provider>-<providerAccountId>` (ก่อนสัญญา v1.3.0) และ `guest-<uuid>`
 * id ที่ Backend ออกตั้งแต่ v1.3.0 (`usr-<uuid>`) ไม่บอก provider → null
 */
export function providerFromUserId(userId: string): AuthProvider | null {
  const match = LEGACY_USER_ID_PATTERN.exec(userId);
  return match ? (match[1] as AuthProvider) : null;
}

export function isGuestId(userId: string): boolean {
  return userId.startsWith('guest-');
}

/**
 * ตาราง layouts/share_links/contact_messages อ้าง users ด้วย FK — ต้องมีแถวผู้ใช้ก่อนเขียนข้อมูลชิ้นแรก
 * บัญชีใหม่เกิดจาก resolve / otp verify แล้ว; สร้างแถวขั้นต่ำให้เฉพาะ session รูปแบบเดิม (ผู้ใช้/Guest ก่อน v1.3.0)
 * `usr-…` ที่ไม่มีแถว = บัญชีถูกลบไปแล้ว → 401
 */
export async function ensureUser(client: PoolClient, userId: string): Promise<void> {
  const exists = await client.query('SELECT 1 FROM users WHERE id = $1', [userId]);
  if ((exists.rowCount ?? 0) > 0) return;
  const provider = providerFromUserId(userId);
  if (provider === null) throw unauthorized('token subject is not a known user');

  await client.query('INSERT INTO users (id, provider) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [
    userId,
    provider,
  ]);
}

type Queryable = Pool | PoolClient;

interface UserRow {
  id: string;
  provider: AuthProvider;
  name: string | null;
  email: string | null;
  image: string | null;
  created_at: Date;
  updated_at: Date;
}

const USER_COLUMNS = 'id, provider, name, email, image, created_at, updated_at';

function toUser(row: UserRow): User {
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    email: row.email,
    image: row.image,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function findUser(db: Queryable, userId: string): Promise<User | null> {
  const result = await db.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [userId]);
  const row = result.rows[0];
  return row ? toUser(row) : null;
}

/** อัปเดตโปรไฟล์ — ฟิลด์ที่ไม่ส่งมาคงค่าเดิม, `null` = ล้างค่า; ไม่มีผู้ใช้ → null (ไม่สร้างบัญชี) */
export async function updateProfile(
  db: Queryable,
  userId: string,
  profile: UpdateProfileRequest,
): Promise<User | null> {
  const result = await db.query<UserRow>(
    `UPDATE users SET
       name = CASE WHEN $5 THEN $2 ELSE name END,
       email = CASE WHEN $6 THEN $3 ELSE email END,
       image = CASE WHEN $7 THEN $4 ELSE image END,
       updated_at = now()
     WHERE id = $1
     RETURNING ${USER_COLUMNS}`,
    [
      userId,
      profile.name ?? null,
      profile.email ?? null,
      profile.image ?? null,
      profile.name !== undefined,
      profile.email !== undefined,
      profile.image !== undefined,
    ],
  );
  const row = result.rows[0];
  return row ? toUser(row) : null;
}

/** ลบผู้ใช้ — FK `ON DELETE CASCADE` ลบ layouts, share_links และ contact_messages ตามไปด้วย */
export async function deleteUser(db: Queryable, userId: string): Promise<boolean> {
  const result = await db.query('DELETE FROM users WHERE id = $1', [userId]);
  return (result.rowCount ?? 0) > 0;
}

export async function listContactMessagesForUser(
  db: Queryable,
  userId: string,
): Promise<AccountExport['contactMessages']> {
  const result = await db.query<{ name: string; email: string; message: string; received_at: Date }>(
    'SELECT name, email, message, received_at FROM contact_messages WHERE user_id = $1 ORDER BY received_at DESC',
    [userId],
  );
  return result.rows.map((row) => ({
    name: row.name,
    email: row.email,
    message: row.message,
    receivedAt: row.received_at.toISOString(),
  }));
}

export async function moveContactMessages(db: Queryable, fromUser: string, toUser: string): Promise<void> {
  await db.query('UPDATE contact_messages SET user_id = $2 WHERE user_id = $1', [fromUser, toUser]);
}

/** ตัวนับ rate limit มี id ผู้ใช้อยู่ใน key — ลบทิ้งด้วยเมื่อผู้ใช้ขอลบข้อมูล (+ key อื่นที่ผูกกับผู้ใช้ เช่น hash อีเมล) */
export async function deleteUserRateLimits(db: Queryable, userId: string, extraKeys: string[] = []): Promise<void> {
  await db.query('DELETE FROM rate_limits WHERE key = ANY($1::text[])', [[`contact:user:${userId}`, ...extraKeys]]);
}

export { toUser, USER_COLUMNS };
export type { UserRow };
