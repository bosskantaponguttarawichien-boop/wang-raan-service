import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { requireUserId } from '../../middleware/auth.js';
import { UsersService } from './users.service.js';

export function registerUserRoutes(app: FastifyInstance, pool: Pool): void {
  const service = new UsersService(pool);

  app.get('/v1/me', async (request) => service.get(requireUserId(request)));

  app.put('/v1/me', async (request) => service.upsert(requireUserId(request), request.body));

  app.delete('/v1/me', async (request, reply) => {
    await service.delete(requireUserId(request));
    return reply.status(204).send();
  });

  app.get('/v1/me/export', async (request) => service.export(requireUserId(request)));

  app.post('/v1/me/merge-guest', async (request) => service.mergeGuest(requireUserId(request), request.body));
}
