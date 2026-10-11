import type { Pool } from 'pg';
import { withTransaction } from '../../db/transaction.js';
import type { AuthContext } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errors.js';
import type { ContactNotification } from '../../services/notifier.js';
import { consumeRateLimits } from '../../services/rate-limiter.js';
import type { RateLimitRule } from '../../services/rate-limiter.js';
import { ensureUser } from '../users/users.repository.js';
import { insertContactMessage } from './contact.repository.js';
import { CONTACT_RATE_LIMITS, ContactMessageRequestSchema } from './contact.schemas.js';

export class ContactService {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** บันทึกข้อความ — rate limit กับการ insert อยู่ใน transaction เดียว ถ้าเกินจะ rollback ทั้งหมด */
  async submit(auth: AuthContext, clientIp: string | null, body: unknown): Promise<ContactNotification> {
    const input = ContactMessageRequestSchema.parse(body);
    if (clientIp === null) {
      throw new AppError(400, 'INVALID_REQUEST', 'X-Client-IP header is required', {
        details: [{ path: 'X-Client-IP', message: 'required (1-64 characters)' }],
      });
    }

    const userId = auth.isAnonymous ? null : auth.userId;
    const rules: RateLimitRule[] = [
      { key: `contact:ip:${clientIp}`, limit: CONTACT_RATE_LIMITS.ip },
      { key: 'contact:global', limit: CONTACT_RATE_LIMITS.global },
    ];
    if (userId) rules.push({ key: `contact:user:${userId}`, limit: CONTACT_RATE_LIMITS.user });

    return withTransaction(this.pool, async (client) => {
      const decision = await consumeRateLimits(client, rules, this.now());
      if (!decision.allowed) {
        throw new AppError(429, 'RATE_LIMITED', 'too many contact messages, try again later', {
          retryAfter: decision.retryAfter,
        });
      }

      if (userId) await ensureUser(client, userId);
      const stored = await insertContactMessage(client, { userId, clientIp, ...input });
      return { id: stored.id, receivedAt: stored.receivedAt.toISOString(), ...input };
    });
  }
}
