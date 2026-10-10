import { SaveLayoutRequestSchema, validateLayout } from '@bosskantaponguttarawichien-boop/wang-raan-core';
import type { SaveLayoutRequest, StoreLayout, ValidationResult } from '@bosskantaponguttarawichien-boop/wang-raan-core';

export type LayoutParseResult =
  | {
      success: true;
      layout: StoreLayout;
      validation: ValidationResult;
    }
  | {
      success: false;
      issues: string[];
    };

/**
 * ตรวจ payload ด้วย Zod schema และคำนวณผลตรวจด้วย rule engine ชุดเดียวกับ BFF
 * Route ใน feature ถัดไปต้องใช้ผลลัพธ์นี้ก่อนเขียนข้อมูลลงฐานข้อมูลเสมอ
 */
export function parseAndValidateLayout(payload: unknown): LayoutParseResult {
  const parsed = SaveLayoutRequestSchema.safeParse(payload);

  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => issue.message),
    };
  }

  return validateParsedLayout(parsed.data);
}

export function validateParsedLayout(request: SaveLayoutRequest): LayoutParseResult {
  // Zod 3 อนุมาน optional field เป็น `T | undefined` ขณะที่ type domain ของ core
  // ใช้ optional property แบบ exact; HTTP JSON ไม่มีค่า undefined หลัง schema parse แล้ว
  const layout = request.layout as StoreLayout;

  return {
    success: true,
    layout,
    validation: validateLayout(layout),
  };
}
