import { createHash } from 'node:crypto';

/** เทียบอีเมลหลัง trim + lowercase (ไม่ตัดจุด/+tag ของ gmail — สัญญา resolveIdentity) */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** เก็บ/ค้นอีเมลในตาราง OTP และ key ของ rate limit เป็น hash — ไม่ให้อีเมลเต็มหลุดไปอยู่ในตารางที่ไม่ใช่บัญชี */
export function emailHash(email: string): string {
  return createHash('sha256').update(normalizeEmail(email)).digest('hex');
}
