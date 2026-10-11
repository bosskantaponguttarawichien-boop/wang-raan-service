import { ZodError } from 'zod';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, notFound } from './errors.js';
import type { ErrorDetail } from './errors.js';

const FASTIFY_ERROR_MAP: Record<string, () => AppError> = {
  FST_ERR_CTP_BODY_TOO_LARGE: () => new AppError(413, 'PAYLOAD_TOO_LARGE', 'request body is too large'),
  FST_ERR_CTP_INVALID_MEDIA_TYPE: () =>
    new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'content-type must be application/json'),
  FST_ERR_CTP_INVALID_JSON_BODY: () => new AppError(400, 'INVALID_JSON', 'request body is not valid JSON'),
  FST_ERR_CTP_EMPTY_JSON_BODY: () => new AppError(400, 'INVALID_JSON', 'request body is empty'),
};

function zodDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

/** แปลง error ทุกชนิดให้เป็น AppError — สิ่งที่ไม่รู้จักถือเป็น 500 และไม่เปิดเผยรายละเอียดภายใน */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) {
    return new AppError(400, 'INVALID_REQUEST', 'request validation failed', { details: zodDetails(error) });
  }

  const fastifyError = error as Partial<FastifyError>;
  const mapped = fastifyError.code ? FASTIFY_ERROR_MAP[fastifyError.code] : undefined;
  if (mapped) return mapped();

  if (fastifyError.validation) {
    return new AppError(400, 'INVALID_REQUEST', 'request validation failed', {
      details: fastifyError.validation.map((item) => ({
        path: item.instancePath.replace(/^\//, '').replaceAll('/', '.'),
        message: item.message ?? 'is invalid',
      })),
    });
  }

  const statusCode = fastifyError.statusCode;
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
    return new AppError(400, 'INVALID_REQUEST', 'invalid request');
  }

  return new AppError(500, 'INTERNAL_ERROR', 'internal server error');
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const appError = toAppError(error);

    if (appError.statusCode >= 500) {
      request.log.error({ err: error }, 'unhandled error');
    } else {
      request.log.info({ code: appError.code, statusCode: appError.statusCode }, 'request rejected');
    }

    if (appError.extras.retryAfter !== undefined) reply.header('retry-after', String(appError.extras.retryAfter));
    return reply.status(appError.statusCode).send(appError.toBody());
  });

  app.setNotFoundHandler((_request, reply) => {
    const appError = notFound('route not found');
    return reply.status(appError.statusCode).send(appError.toBody());
  });
}

/**
 * error ระดับ router (URL ถอดรหัสไม่ได้ / path param ยาวเกิน) เกิดก่อน hook ใด ๆ
 * path แบบนี้ชี้ไปยังทรัพยากรที่มีอยู่ไม่ได้ จึงตอบ 404 ในรูปแบบเดียวกับสัญญา
 */
export function sendFrameworkError(error: FastifyError, request: FastifyRequest, reply: FastifyReply): void {
  request.log.info({ code: error.code }, 'request rejected by router');
  const appError = notFound('route not found');
  void reply.status(appError.statusCode).send(appError.toBody());
}
