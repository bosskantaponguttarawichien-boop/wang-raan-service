import Fastify, { LogController } from 'fastify';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { loadConfig } from './config/env.js';
import type { AppConfig } from './config/env.js';
import { registerAuth } from './middleware/auth.js';
import { registerErrorHandler } from './middleware/error-handler.js';
import { BODY_LIMITS } from './middleware/payload-limiter.js';
import { generateRequestId, registerRequestContext } from './middleware/request-context.js';

export interface BuildAppOptions {
  config?: AppConfig;
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
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
    bodyLimit: BODY_LIMITS.default,
    ...options.fastify,
  });

  registerErrorHandler(app);
  registerRequestContext(app);
  registerAuth(app, config.internalTokenSecret);

  return app;
}
