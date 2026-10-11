import { z } from 'zod';
import type { StoreLayout, ValidationResult } from '@bosskantaponguttarawichien-boop/wang-raan-core';

export const MAX_ACTIVE_SHARES_PER_LAYOUT = 20;
export const MAX_SHARE_LIFETIME_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ShareStatus = 'active' | 'expired' | 'revoked';

/** ตรงกับ `components.schemas.ShareLink` */
export interface ShareLink {
  shareKey: string;
  layoutId: string;
  status: ShareStatus;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

/** ตรงกับ `components.schemas.PublicShare` — ห้ามมีข้อมูลเจ้าของ */
export interface PublicShare {
  layout: StoreLayout;
  validation: ValidationResult;
  createdAt: string;
  expiresAt: string | null;
}

export interface ShareKeyParams {
  shareKey: string;
}

const ExpiresAtSchema = z.string().datetime({ offset: true }).nullable();

export const CreateShareRequestSchema = z.object({ expiresAt: ExpiresAtSchema.optional() }).strict();
export const UpdateShareRequestSchema = z.object({ expiresAt: ExpiresAtSchema }).strict();

/** สถานะคำนวณตอนตอบเสมอ — revoked มาก่อน expired */
export function shareStatus(row: { expiresAt: Date | null; revokedAt: Date | null }, now: Date): ShareStatus {
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'active';
}

/** `expiresAt` ต้องอยู่ในอนาคตและไม่เกิน 365 วัน; null = ไม่หมดอายุ; คืนข้อความผิดพลาดหรือ null */
export function expiryProblem(expiresAt: Date | null, now: Date): string | null {
  if (expiresAt === null) return null;
  if (expiresAt.getTime() <= now.getTime()) return 'must be in the future';
  if (expiresAt.getTime() > now.getTime() + MAX_SHARE_LIFETIME_DAYS * DAY_MS) {
    return `must be within ${MAX_SHARE_LIFETIME_DAYS} days`;
  }
  return null;
}
