import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { IncomingMessage } from 'node:http';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CLIENT_IP_LENGTH = 64;

declare module 'fastify' {
  interface FastifyRequest {
    /** IP จริงของผู้ใช้จาก `X-Client-IP` ที่ BFF คำนวณมาแล้ว; null เมื่อไม่มีหรือผิดรูปแบบ */
    clientIp: string | null;
  }
}

/**
 * ใช้ `X-Request-Id` จาก BFF เป็น request id ของ Fastify (log label `requestId`)
 * ถ้าไม่มีหรือไม่ใช่ UUID ให้สร้างใหม่ เพื่อไม่ให้ค่าที่ไม่น่าเชื่อถือไหลเข้า log
 */
export function generateRequestId(request: IncomingMessage): string {
  const header = request.headers['x-request-id'];
  return typeof header === 'string' && UUID_PATTERN.test(header) ? header : randomUUID();
}

export function parseClientIp(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') return null;
  const value = header.trim();
  return value.length > 0 && value.length <= MAX_CLIENT_IP_LENGTH ? value : null;
}

export function registerRequestContext(app: FastifyInstance): void {
  app.decorateRequest('clientIp', null);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    request.clientIp = parseClientIp(request.headers['x-client-ip']);
  });
}
