import type { FastifyInstance } from 'fastify';
import { checkHealth } from './health.service.js';
import type { DatabaseProbeTarget } from './health.service.js';

export interface HealthRouteOptions {
  database: DatabaseProbeTarget | undefined;
  version: string;
  probeTimeoutMs?: number;
}

/** `GET /health` — endpoint เดียวที่ไม่ต้องมี internal token (`security: []` ในสัญญา) */
export function registerHealthRoutes(app: FastifyInstance, options: HealthRouteOptions): void {
  app.get('/health', { config: { auth: 'none' } }, async (request, reply) => {
    const report = await checkHealth(
      options.database,
      options.version,
      (error) => request.log.warn({ err: error }, 'database health probe failed'),
      options.probeTimeoutMs,
    );

    return reply
      .header('cache-control', 'no-store')
      .status(report.status === 'ok' ? 200 : 503)
      .send(report);
  });
}
