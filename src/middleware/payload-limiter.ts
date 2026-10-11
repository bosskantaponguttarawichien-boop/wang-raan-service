/**
 * เพดานขนาด body ตามสัญญา — ใช้กับ route option `bodyLimit`
 * ค่า `default` ตั้งเป็น bodyLimit ระดับ app; route ผัง/ฟอร์มติดต่อต้องระบุค่าของตัวเอง
 * เกินเพดาน Fastify จะโยน FST_ERR_CTP_BODY_TOO_LARGE ซึ่ง error handler แปลงเป็น 413 PAYLOAD_TOO_LARGE
 */
export const BODY_LIMITS = {
  layout: 512 * 1024,
  contactMessage: 8 * 1024,
  default: 1024,
} as const;
