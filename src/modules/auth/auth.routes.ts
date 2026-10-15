import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { OtpMailer } from '../../services/mailer.js';
import { AuthService } from './auth.service.js';

/** ล็อกอิน (สัญญา v1.3.0) — BFF เรียกด้วย `sub: anonymous` และส่ง X-Client-IP เสมอ */
export function registerAuthRoutes(
  app: FastifyInstance,
  pool: Pool,
  options: { secret: string; mailer: OtpMailer | null; testCode: string | null; now?: (() => Date) | undefined },
): void {
  const service = new AuthService(pool, options);
  const anonymous = { config: { auth: 'anonymous' as const } };

  app.post('/v1/auth/identities/resolve', anonymous, async (request) =>
    service.resolve(request.clientIp, request.body),
  );
  app.post('/v1/auth/otp/request', anonymous, async (request) => service.requestOtp(request.clientIp, request.body));
  app.post('/v1/auth/otp/verify', anonymous, async (request) => service.verifyOtp(request.clientIp, request.body));
}
