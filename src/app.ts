import Fastify, { LogController } from 'fastify';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import type { Pool } from 'pg';
import { loadConfig } from './config/env.js';
import type { AppConfig } from './config/env.js';
import { registerAuth } from './middleware/auth.js';
import { registerErrorHandler, sendFrameworkError } from './middleware/error-handler.js';
import { BODY_LIMITS } from './middleware/payload-limiter.js';
import { generateRequestId, registerRequestContext } from './middleware/request-context.js';
import { registerHealthRoutes } from './modules/health/health.routes.js';
import { registerLayoutRoutes } from './modules/layouts/layouts.routes.js';
import { registerShareRoutes } from './modules/shares/shares.routes.js';

export interface BuildAppOptions {
  config?: AppConfig;
  /**
   * PostgreSQL pool ที่ผู้เรียกเป็นเจ้าของและต้องปิดเอง
   * ไม่ส่งมา = ลงทะเบียนเฉพาะ `/health` (รายงาน `unavailable`) — ใช้ในเทสของ middleware
   */
  database?: Pool;
  fastify?: FastifyServerOptions;
}

/**
 * สร้าง Fastify application พร้อม pipeline กลาง (tracing → auth → body limit → error format)
 * แต่ละ feature จะเพิ่ม route ผ่าน module ของตนเองเพื่อคงขอบเขตงานให้ชัดเจน
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();

  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    genReqId: generateRequestId,
    logController: new LogController({
      requestIdLogLabel: 'requestId',
      // health check ถูกเรียกถี่โดย platform — ไม่ต้องบันทึก request log ทุกครั้ง
      disableRequestLogging: (request: { url?: string }) => request.url === '/health',
    }),
    bodyLimit: BODY_LIMITS.default,
    // id ยาวได้ 128 ตัวอักษร — เผื่อ percent-encoding ของอักขระหลายไบต์ (สูงสุด 9 ไบต์ต่อตัว)
    maxParamLength: 2048,
    frameworkErrors: sendFrameworkError,
    ...options.fastify,
  });

  registerErrorHandler(app);
  registerRequestContext(app);
  registerAuth(app, config.internalTokenSecret);

  // สัญญารับเฉพาะ JSON — ปิด parser text/plain ที่ Fastify มีให้ เพื่อให้ตอบ 415 ตามสัญญา
  app.removeContentTypeParser('text/plain');

  registerHealthRoutes(app, { database: options.database, version: config.version });

  if (options.database) {
    registerLayoutRoutes(app, options.database);
    registerShareRoutes(app, options.database);
  }

  return app;
}
