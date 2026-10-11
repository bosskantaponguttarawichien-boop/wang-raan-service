import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { BODY_LIMITS } from '../../middleware/payload-limiter.js';
import type { Notifier } from '../../services/notifier.js';
import type { ContactMessageAccepted } from './contact.schemas.js';
import { ContactService } from './contact.service.js';

export function registerContactRoutes(app: FastifyInstance, pool: Pool, notifier: Notifier, now?: () => Date): void {
  const service = new ContactService(pool, now);

  app.post(
    '/v1/contact-messages',
    { config: { auth: 'anonymous' }, bodyLimit: BODY_LIMITS.contactMessage },
    async (request, reply) => {
      if (!request.auth) throw new Error('auth context missing on an authenticated route');
      const accepted = await service.submit(request.auth, request.clientIp, request.body);

      // แจ้งเตือนหลัง commit แบบไม่รอ — webhook ช้าหรือล่มต้องไม่กระทบผู้ใช้ และห้าม log ข้อมูลส่วนบุคคล
      notifier.notifyContactMessage(accepted).catch((error: unknown) => {
        request.log.warn(
          { contactMessageId: accepted.id, reason: error instanceof Error ? error.message : 'unknown' },
          'contact notification failed',
        );
      });

      const body: ContactMessageAccepted = { id: accepted.id, receivedAt: accepted.receivedAt };
      return reply.status(202).send(body);
    },
  );
}
