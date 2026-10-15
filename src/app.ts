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
import { registerUserRoutes } from './modules/users/users.routes.js';
import { registerContactRoutes } from './modules/contact/contact.routes.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { createResendMailer, noopMailer } from './services/mailer.js';
import type { OtpMailer } from './services/mailer.js';
import { createWebhookNotifier, noopNotifier } from './services/notifier.js';
import type { Notifier } from './services/notifier.js';

export interface BuildAppOptions {
  config?: AppConfig;
  /**
   * PostgreSQL pool ที่ผู้เรียกเป็นเจ้าของและต้องปิดเอง
   * ไม่ส่งมา = ลงทะเบียนเฉพาะ `/health` (รายงาน `unavailable`) — ใช้ในเทสของ middleware
   */
  database?: Pool;
  /** ช่องทางแจ้งเตือนข้อความติดต่อ — ค่าเริ่มต้นมาจาก `CONTACT_WEBHOOK_URL` */
  notifier?: Notifier;
  /** นาฬิกาของหน้าต่าง rate limit ฟอร์มติดต่อ / OTP — ฉีดได้ในเทสเพื่อไม่ให้ข้ามขอบหน้าต่าง */
  clock?: () => Date;
  /** ช่องทางส่งรหัส OTP — ค่าเริ่มต้นมาจาก config (Resend) หรือไม่ส่งจริงนอก production */
  mailer?: OtpMailer | null;
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
    registerLayoutRoutes(app, options.database, config.internalTokenSecret);
    registerShareRoutes(app, options.database);
    registerUserRoutes(app, options.database);
    const notifier =
      options.notifier ?? (config.contactWebhookUrl ? createWebhookNotifier(config.contactWebhookUrl) : noopNotifier);
    registerContactRoutes(app, options.database, notifier, options.clock);
    // production ที่ยังไม่ตั้งค่าเมล → mailer null (otp/request ตอบ 503) แทนการปล่อยให้ล็อกอินเงียบ ๆ
    const mailer =
      options.mailer !== undefined
        ? options.mailer
        : config.mail
          ? createResendMailer(config.mail.resendApiKey, config.mail.from)
          : config.production
            ? null
            : noopMailer;
    registerAuthRoutes(app, options.database, {
      secret: config.internalTokenSecret,
      mailer,
      testCode: config.otpTestCode,
      now: options.clock,
    });
  }

  return app;
}
