import type { Pool, PoolClient } from 'pg';
import type { Identity, User } from '../users/users.schemas.js';
import { toUser, USER_COLUMNS } from '../users/users.repository.js';
import type { UserRow } from '../users/users.repository.js';
import type { IdentityProvider } from './auth.schemas.js';

type Queryable = PoolClient | Pool;

/** ล็อกระดับ transaction ตาม key — กันล็อกอินครั้งแรกพร้อมกันสร้างบัญชีซ้ำ */
export async function lockKey(client: PoolClient, key: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
}

export async function findUserByIdentity(
  client: PoolClient,
  provider: IdentityProvider,
  providerAccountId: string,
): Promise<User | null> {
  const result = await client.query<UserRow>(
    `SELECT ${USER_COLUMNS.split(', ')
      .map((c) => `u.${c}`)
      .join(', ')}
       FROM identities i JOIN users u ON u.id = i.user_id
      WHERE i.provider = $1 AND i.provider_account_id = $2`,
    [provider, providerAccountId],
  );
  const row = result.rows[0];
  return row ? toUser(row) : null;
}

/**
 * บัญชีที่มีอีเมลนี้ **ยืนยันแล้ว** ผ่าน provider ที่เชื่ออีเมลได้ (google / email OTP) — หลายบัญชีเลือกที่สร้างก่อน
 * LINE / GitHub ไม่นับแม้ส่ง emailVerified มา (กันจองอีเมลคนอื่นไว้ล่วงหน้า)
 */
export async function findUserByVerifiedEmail(client: PoolClient, email: string): Promise<User | null> {
  const result = await client.query<UserRow>(
    `SELECT ${USER_COLUMNS.split(', ')
      .map((c) => `u.${c}`)
      .join(', ')}
       FROM identities i JOIN users u ON u.id = i.user_id
      WHERE i.email = $1 AND i.email_verified AND i.provider IN ('google', 'email')
      ORDER BY u.created_at, u.id
      LIMIT 1`,
    [email],
  );
  const row = result.rows[0];
  return row ? toUser(row) : null;
}

/** บันทึก identity (ครั้งแรกผูกกับ userId; ครั้งต่อไปไม่ย้ายบัญชี แค่อัปเดตอีเมลและเวลาล็อกอินล่าสุด) */
export async function upsertIdentity(
  client: PoolClient,
  identity: {
    provider: IdentityProvider;
    providerAccountId: string;
    userId: string;
    email: string | null;
    emailVerified: boolean;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO identities (provider, provider_account_id, user_id, email, email_verified)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (provider, provider_account_id) DO UPDATE SET
       email = EXCLUDED.email, email_verified = EXCLUDED.email_verified, last_login_at = now()`,
    [identity.provider, identity.providerAccountId, identity.userId, identity.email, identity.emailVerified],
  );
}

export async function listIdentities(db: Queryable, userId: string): Promise<Identity[]> {
  const result = await db.query<{
    provider: Identity['provider'];
    provider_account_id: string;
    email: string | null;
    email_verified: boolean;
    created_at: Date;
    last_login_at: Date;
  }>(
    `SELECT provider, provider_account_id, email, email_verified, created_at, last_login_at
       FROM identities WHERE user_id = $1 ORDER BY created_at, provider`,
    [userId],
  );
  return result.rows.map((row) => ({
    provider: row.provider,
    providerAccountId: row.provider_account_id,
    email: row.email,
    emailVerified: row.email_verified,
    createdAt: row.created_at.toISOString(),
    lastLoginAt: row.last_login_at.toISOString(),
  }));
}

/** อีเมลทั้งหมดที่ผูกกับบัญชี (identities + โปรไฟล์) — ใช้ล้าง OTP/rate limit ตอนลบบัญชี */
export async function emailsOfUser(db: Queryable, userId: string): Promise<string[]> {
  const result = await db.query<{ email: string }>(
    `SELECT email FROM identities WHERE user_id = $1 AND email IS NOT NULL
     UNION SELECT lower(btrim(email)) FROM users WHERE id = $1 AND email IS NOT NULL`,
    [userId],
  );
  return result.rows.map((row) => row.email);
}

/** สร้างบัญชีใหม่ — id ที่ Backend ออก (`usr-<uuid>` / `guest-<uuid>`) */
export async function insertUser(
  client: PoolClient,
  user: {
    id: string;
    provider: User['provider'];
    name?: string | null | undefined;
    email?: string | null | undefined;
    image?: string | null | undefined;
  },
): Promise<User> {
  const result = await client.query<UserRow>(
    `INSERT INTO users (id, provider, name, email, image) VALUES ($1, $2, $3, $4, $5) RETURNING ${USER_COLUMNS}`,
    [user.id, user.provider, user.name ?? null, user.email ?? null, user.image ?? null],
  );
  return toUser(result.rows[0] as UserRow);
}

/** ล็อกอินแล้ว: provider = วิธีล่าสุด, เติม name/email/image เฉพาะช่องที่ยังว่าง (ไม่ทับค่าที่ผู้ใช้แก้เอง) */
export async function touchUserOnLogin(
  client: PoolClient,
  userId: string,
  login: {
    provider: User['provider'];
    name?: string | null | undefined;
    email?: string | null | undefined;
    image?: string | null | undefined;
  },
): Promise<User> {
  const result = await client.query<UserRow>(
    `UPDATE users SET provider = $2,
       name = COALESCE(name, $3), email = COALESCE(email, $4), image = COALESCE(image, $5), updated_at = now()
     WHERE id = $1 RETURNING ${USER_COLUMNS}`,
    [userId, login.provider, login.name ?? null, login.email ?? null, login.image ?? null],
  );
  return toUser(result.rows[0] as UserRow);
}
