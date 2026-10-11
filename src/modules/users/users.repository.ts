import type { PoolClient } from 'pg';
import { unauthorized } from '../../middleware/errors.js';

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
