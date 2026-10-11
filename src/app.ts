import Fastify, { LogController } from 'fastify';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { loadConfig } from './config/env.js';
import type { AppConfig } from './config/env.js';
import { registerAuth } from './middleware/auth.js';
import { registerErrorHandler } from './middleware/error-handler.js';
import { BODY_LIMITS } from './middleware/payload-limiter.js';
import { generateRequestId, registerRequestContext } from './middleware/request-context.js';
import { registerHealthRoutes } from './modules/health/health.routes.js';
import type { DatabaseProbeTarget } from './modules/health/health.service.js';

export interface BuildAppOptions {
  config?: AppConfig;
  /** PostgreSQL pool ที่ผู้เรียกเป็นเจ้าของและต้องปิดเอง — ไม่ส่งมา health จะรายงาน `unavailable` */
  database?: DatabaseProbeTarget;
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
    ...options.fastify,
  });

  registerErrorHandler(app);
  registerRequestContext(app);
  registerAuth(app, config.internalTokenSecret);

  registerHealthRoutes(app, { database: options.database, version: config.version });

  return app;
}
