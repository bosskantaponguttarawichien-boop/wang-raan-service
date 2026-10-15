import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { requireUserId as ownerOf } from '../../middleware/auth.js';
import { BODY_LIMITS } from '../../middleware/payload-limiter.js';
import type { LayoutParams } from './layouts.schemas.js';
import { LayoutsService } from './layouts.service.js';

export function registerLayoutRoutes(app: FastifyInstance, pool: Pool, cursorSecret: string): void {
  const service = new LayoutsService(pool, cursorSecret);

  app.get('/v1/layouts', async (request) => service.list(ownerOf(request), request.query));

  app.post('/v1/layouts', { bodyLimit: BODY_LIMITS.layout }, async (request, reply) => {
    const stored = await service.create(ownerOf(request), request.body);
    return reply.status(201).send(stored);
  });

  app.get<{ Params: LayoutParams }>('/v1/layouts/:layoutId', async (request) =>
    service.get(ownerOf(request), request.params.layoutId),
  );

  app.put<{ Params: LayoutParams }>('/v1/layouts/:layoutId', { bodyLimit: BODY_LIMITS.layout }, async (request) =>
    service.update(ownerOf(request), request.params.layoutId, request.body),
  );

  app.delete<{ Params: LayoutParams }>('/v1/layouts/:layoutId', async (request, reply) => {
    await service.delete(ownerOf(request), request.params.layoutId);
    return reply.status(204).send();
  });
}
