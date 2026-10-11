const SHARE_KEY_BYTES = 32;
export const SHARE_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** shareKey = สุ่ม 32 ไบต์จาก CSPRNG แล้วเข้ารหัส base64url (ไม่มี padding) ได้ 43 ตัวอักษร */
export function generateShareKey(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(SHARE_KEY_BYTES))).toString('base64url');
}

export function isShareKey(value: string): boolean {
  return SHARE_KEY_PATTERN.test(value);
}
