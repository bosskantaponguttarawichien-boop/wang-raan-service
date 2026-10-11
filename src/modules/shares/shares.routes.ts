import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { requireUserId } from '../../middleware/auth.js';
import type { LayoutParams } from '../layouts/layouts.schemas.js';
import type { ShareKeyParams } from './shares.schemas.js';
import { SharesService } from './shares.service.js';

export function registerShareRoutes(app: FastifyInstance, pool: Pool): void {
  const service = new SharesService(pool);

  app.get<{ Params: LayoutParams }>('/v1/layouts/:layoutId/shares', async (request) => ({
    shares: await service.list(requireUserId(request), request.params.layoutId),
  }));

  app.post<{ Params: LayoutParams }>('/v1/layouts/:layoutId/shares', async (request, reply) => {
    const share = await service.create(requireUserId(request), request.params.layoutId, request.body);
    return reply.status(201).send(share);
  });

  app.patch<{ Params: ShareKeyParams }>('/v1/shares/:shareKey', async (request) =>
    service.updateExpiry(requireUserId(request), request.params.shareKey, request.body),
  );

  app.delete<{ Params: ShareKeyParams }>('/v1/shares/:shareKey', async (request, reply) => {
    await service.revoke(requireUserId(request), request.params.shareKey);
    return reply.status(204).send();
  });

  app.get<{ Params: ShareKeyParams }>(
    '/v1/public/shares/:shareKey',
    { config: { auth: 'anonymous' } },
    async (request) => service.getPublic(request.params.shareKey),
  );
}
