import { jwtVerify } from 'jose';
import type { FastifyInstance } from 'fastify';
import { unauthorized } from './errors.js';

export const TOKEN_ISSUER = 'wang-raan-bff';
export const TOKEN_AUDIENCE = 'wang-raan-backend';
export const TOKEN_MAX_LIFETIME_SECONDS = 300;
export const TOKEN_CLOCK_TOLERANCE_SECONDS = 5;
export const ANONYMOUS_SUBJECT = 'anonymous';
const MAX_SUBJECT_LENGTH = 128;

/**
 * นโยบายต่อ route ผ่าน `config.auth`:
 * - `user` (ค่าเริ่มต้น) ต้องมี token และ `sub` ต้องไม่ใช่ anonymous
 * - `anonymous` ตรงกับ `x-allow-anonymous: true` ใน OpenAPI — ต้องมี token แต่ `sub` เป็น anonymous ได้
 * - `none` ไม่ตรวจ token (ใช้กับ `GET /health` เท่านั้น)
 */
export type AuthMode = 'user' | 'anonymous' | 'none';

export interface AuthContext {
  userId: string;
  isAnonymous: boolean;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    auth?: AuthMode;
  }
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

/** ตรวจ internal token จาก BFF; คืน null เมื่อไม่ผ่านด้วยเหตุผลใดก็ตาม (ไม่บอกสาเหตุออกไปภายนอก) */
export async function verifyInternalToken(
  authorization: string | undefined,
  secretKey: Uint8Array,
): Promise<AuthContext | null> {
  if (!authorization?.startsWith('Bearer ')) return null;

  try {
    const { payload } = await jwtVerify(authorization.slice('Bearer '.length), secretKey, {
      algorithms: ['HS256'],
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      clockTolerance: TOKEN_CLOCK_TOLERANCE_SECONDS,
      maxTokenAge: TOKEN_MAX_LIFETIME_SECONDS,
      requiredClaims: ['sub', 'iat', 'exp'],
    });

    const { sub, iat, exp } = payload;
    if (typeof sub !== 'string' || sub.length === 0 || sub.length > MAX_SUBJECT_LENGTH) return null;
    // token ที่ BFF ออกให้อายุยาวเกินกำหนดถือว่าผิดสัญญา แม้ยังไม่หมดอายุ
    if (iat === undefined || exp === undefined || exp - iat > TOKEN_MAX_LIFETIME_SECONDS) return null;

    return { userId: sub, isAnonymous: sub === ANONYMOUS_SUBJECT };
  } catch {
    return null;
  }
}

/**
 * ลงทะเบียน hook ตรวจสิทธิ์ที่ระดับ root — ครอบทุก route รวมถึง 404 handler
 * และทำงานใน `onRequest` ก่อน parse body เพื่อไม่ให้คำขอที่ไม่ผ่านสิทธิ์ได้ใช้ทรัพยากร
 */
export function registerAuth(app: FastifyInstance, secret: string): void {
  const secretKey = new TextEncoder().encode(secret);

  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (request) => {
    const mode: AuthMode = request.routeOptions.config.auth ?? 'user';
    if (mode === 'none') return;

    const context = await verifyInternalToken(request.headers.authorization, secretKey);
    if (context === null) throw unauthorized('invalid or missing internal token');
    if (context.isAnonymous && mode !== 'anonymous') {
      throw unauthorized('anonymous access is not allowed on this endpoint');
    }

    request.auth = context;
  });
}
