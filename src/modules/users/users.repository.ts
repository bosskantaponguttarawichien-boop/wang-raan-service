import type { Pool, PoolClient } from 'pg';
import { unauthorized } from '../../middleware/errors.js';
import type { AccountExport, UpsertProfileRequest, User } from './users.schemas.js';

export type AuthProvider = 'guest' | 'google' | 'line' | 'github';

const USER_ID_PATTERN = /^(guest|google|line|github)-.+$/;

/** id ผู้ใช้มีรูปแบบ `<provider>-<providerAccountId>` (guest-<uuid> สำหรับ Guest) */
export function providerFromUserId(userId: string): AuthProvider | null {
  const match = USER_ID_PATTERN.exec(userId);
  return match ? (match[1] as AuthProvider) : null;
}

export function isGuestId(userId: string): boolean {
  return providerFromUserId(userId) === 'guest';
}

/**
 * ตาราง layouts/share_links/contact_messages อ้าง users ด้วย FK — Guest ไม่ผ่าน `PUT /v1/me`
 * จึงต้องสร้างแถวผู้ใช้ขั้นต่ำก่อนเขียนข้อมูลชิ้นแรก (โปรไฟล์จริงมาจาก PUT /v1/me ภายหลัง)
 */
export async function ensureUser(client: PoolClient, userId: string): Promise<void> {
  const provider = providerFromUserId(userId);
  if (provider === null) throw unauthorized('token subject is not a recognised user id');

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

/** ฟิลด์ที่ไม่ส่งมาคงค่าเดิม; ส่ง `null` มา = ล้างค่า */
export async function upsertUser(db: Queryable, userId: string, profile: UpsertProfileRequest): Promise<User> {
  const result = await db.query<UserRow>(
    `INSERT INTO users (id, provider, name, email, image)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       provider = EXCLUDED.provider,
       name = CASE WHEN $6 THEN EXCLUDED.name ELSE users.name END,
       email = CASE WHEN $7 THEN EXCLUDED.email ELSE users.email END,
       image = CASE WHEN $8 THEN EXCLUDED.image ELSE users.image END,
       updated_at = now()
     RETURNING ${USER_COLUMNS}`,
    [
      userId,
      profile.provider,
      profile.name ?? null,
      profile.email ?? null,
      profile.image ?? null,
      profile.name !== undefined,
      profile.email !== undefined,
      profile.image !== undefined,
    ],
  );
  return toUser(result.rows[0] as UserRow);
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

/** ตัวนับ rate limit มี id ผู้ใช้อยู่ใน key — ลบทิ้งด้วยเมื่อผู้ใช้ขอลบข้อมูล */
export async function deleteUserRateLimits(db: Queryable, userId: string): Promise<void> {
  await db.query('DELETE FROM rate_limits WHERE key = $1', [`contact:user:${userId}`]);
}
