import type { StoreLayout, ValidationResult } from '@bosskantaponguttarawichien-boop/wang-raan-core';

export const MAX_LAYOUTS_PER_USER = 200;
export const MAX_ID_LENGTH = 128;

export interface LayoutParams {
  layoutId: string;
}

/** ตรงกับ `components.schemas.StoredLayout` */
export interface StoredLayout {
  layout: StoreLayout;
  validation: ValidationResult;
  createdAt: string;
  updatedAt: string;
}

/** ตรงกับ `components.schemas.LayoutSummary` */
export interface LayoutSummary {
  id: string;
  width: number;
  depth: number;
  objectCount: number;
  status: ValidationResult['status'];
  updatedAt: string;
}

/** id ใน path ที่ยาวเกินสัญญาไม่มีทางมีอยู่ในระบบ — ตอบ 404 เหมือนไม่พบ */
export function isValidId(id: string): boolean {
  return id.length >= 1 && id.length <= MAX_ID_LENGTH;
}
