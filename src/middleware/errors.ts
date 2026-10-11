import type { ValidationIssue, ValidationResult } from '@bosskantaponguttarawichien-boop/wang-raan-core';

/** ตรงกับ `components.schemas.ErrorCode` ใน contracts/openapi.yaml */
export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'INVALID_JSON'
  | 'INVALID_LAYOUT_SCHEMA'
  | 'ID_MISMATCH'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'PAYLOAD_TOO_LARGE'
  | 'LAYOUT_BLOCKED'
  | 'LAYOUT_EXISTS'
  | 'LAYOUT_LIMIT_REACHED'
  | 'SHARE_LIMIT_REACHED'
  | 'SHARE_REVOKED'
  | 'SHARE_EXPIRED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export interface ErrorDetail {
  path: string;
  message: string;
}

export interface ErrorExtras {
  details?: ErrorDetail[];
  retryAfter?: number;
  validation?: ValidationResult;
  issues?: ValidationIssue[];
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string } & ErrorExtras;
}

/** Error ที่ตั้งใจส่งถึง BFF — error handler จะแปลงเป็น `ErrorBody` ตามสัญญา */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly extras: ErrorExtras;

  constructor(statusCode: number, code: ErrorCode, message: string, extras: ErrorExtras = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.extras = extras;
  }

  toBody(): ErrorBody {
    return { error: { code: this.code, message: this.message, ...this.extras } };
  }
}

export function unauthorized(message = 'authentication required'): AppError {
  return new AppError(401, 'UNAUTHORIZED', message);
}

export function notFound(message = 'resource not found'): AppError {
  return new AppError(404, 'NOT_FOUND', message);
}
