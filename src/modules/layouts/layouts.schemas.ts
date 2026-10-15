import { z } from 'zod';
import type { StoreLayout, ValidationResult } from '@bosskantaponguttarawichien-boop/wang-raan-core';

export const MAX_LAYOUTS_PER_USER = 200;
export const MAX_ID_LENGTH = 128;
export const MAX_NAME_LENGTH = 80;
export const PAGE_DEFAULT = 24;
export const PAGE_MAX = 50;

/** ชื่อผัง: trim แล้วยาว 1–80 code point (สัญญา SaveLayoutRequest.name) */
export const LayoutNameSchema = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, 'name must not be blank')
  .refine((value) => Array.from(value).length <= MAX_NAME_LENGTH, `name must be at most ${MAX_NAME_LENGTH} characters`);

/** query ของ GET /v1/layouts — ค่าอื่นนอกจากนี้ตอบ 400 */
export const ListLayoutsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(PAGE_MAX).default(PAGE_DEFAULT),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

/** ชื่อเริ่มต้นของผังที่ไม่ได้ตั้งชื่อ — รูปแบบเดียวกับ backfill ใน migration 003 และ FE */
export function defaultLayoutName(layout: Pick<StoreLayout, 'width' | 'depth'>): string {
  return `ผังร้าน ${layout.width} × ${layout.depth} ม.`;
}

export interface LayoutParams {
  layoutId: string;
}

/** ตรงกับ `components.schemas.StoredLayout` */
export interface StoredLayout {
  name: string;
  layout: StoreLayout;
  validation: ValidationResult;
  createdAt: string;
  updatedAt: string;
}

/** ตรงกับ `components.schemas.LayoutSummary` */
export interface LayoutSummary {
  id: string;
  name: string;
  width: number;
  depth: number;
  objectCount: number;
  status: ValidationResult['status'];
  updatedAt: string;
  layout: StoreLayout;
}

/** response ของ GET /v1/layouts */
export interface LayoutPage {
  layouts: LayoutSummary[];
  nextCursor: string | null;
}

/** id ใน path ที่ยาวเกินสัญญาไม่มีทางมีอยู่ในระบบ — ตอบ 404 เหมือนไม่พบ */
export function isValidId(id: string): boolean {
  return id.length >= 1 && id.length <= MAX_ID_LENGTH;
}
