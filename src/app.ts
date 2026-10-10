import Fastify from 'fastify';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';

/**
 * สร้าง Fastify application โดยยังไม่ลงทะเบียน route ของโดเมนใด ๆ
 * แต่ละ feature จะเพิ่ม route ผ่าน module ของตนเองเพื่อคงขอบเขตงานให้ชัดเจน
 */
export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  return Fastify({
    logger: true,
    ...options,
  });
}
