import { SignJWT } from 'jose';
import type { AppConfig } from '../../src/config/env.js';

export const TEST_SECRET = 'test-internal-token-secret-0123456789abcdef';
export const TEST_CONFIG: AppConfig = {
  internalTokenSecret: TEST_SECRET,
  logLevel: 'silent',
  version: '9.9.9-test',
  contactWebhookUrl: null,
  production: false,
  mail: null,
  otpTestCode: null,
};

export interface TokenOptions {
  sub?: string | null;
  iss?: string;
  aud?: string;
  iat?: number;
  exp?: number;
  secret?: string;
  alg?: string;
}

/** สร้าง internal token แบบเดียวกับ BFF; override claim ได้เพื่อทดสอบเคสผิด */
export async function signToken(options: TokenOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const iat = options.iat ?? now;
  const jwt = new SignJWT({})
    .setProtectedHeader({ alg: options.alg ?? 'HS256' })
    .setIssuer(options.iss ?? 'wang-raan-bff')
    .setAudience(options.aud ?? 'wang-raan-backend')
    .setIssuedAt(iat)
    .setExpirationTime(options.exp ?? iat + 300);

  if (options.sub !== null) jwt.setSubject(options.sub ?? 'google-1234');

  return jwt.sign(new TextEncoder().encode(options.secret ?? TEST_SECRET));
}
