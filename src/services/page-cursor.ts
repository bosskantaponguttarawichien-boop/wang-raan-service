import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * cursor ทึบของการแบ่งหน้า — BFF ส่งกลับมาตรง ๆ ห้ามแกะ (สัญญา listLayouts)
 * รูปแบบ: base64url(JSON) + "." + HMAC-SHA256 ตัดเหลือ 16 ไบต์ — แก้ค่าหรือสร้างเองไม่ได้ (→ 400)
 * ผูกกับเจ้าของด้วย: cursor ของคนอื่นใช้ไม่ได้ แม้จะไม่รั่วข้อมูลอยู่แล้ว (WHERE owner_id)
 */
export class PageCursor<T extends Record<string, string>> {
  private readonly key: Buffer;

  constructor(secret: string, purpose: string) {
    this.key = createHmac('sha256', secret).update(`page-cursor:${purpose}`).digest();
  }

  private sign(owner: string, body: string): Buffer {
    return createHmac('sha256', this.key).update(`${owner}\n${body}`).digest().subarray(0, 16);
  }

  encode(owner: string, value: T): string {
    const body = Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${body}.${this.sign(owner, body).toString('base64url')}`;
  }

  /** null = cursor เสีย/ถูกแก้/เป็นของคนอื่น */
  decode(owner: string, cursor: string, isValue: (value: unknown) => value is T): T | null {
    const [body, signature, extra] = cursor.split('.');
    if (!body || !signature || extra !== undefined) return null;
    const expected = this.sign(owner, body);
    const given = Buffer.from(signature, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const value: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      return isValue(value) ? value : null;
    } catch {
      return null;
    }
  }
}
