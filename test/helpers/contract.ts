import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { parse } from 'yaml';
import type { LightMyRequestResponse } from 'fastify';

// ajv-formats เป็น CommonJS — default export อยู่ที่ `.default` เมื่อ import จาก ESM
const addFormats = (addFormatsModule as unknown as { default: typeof addFormatsModule }).default ?? addFormatsModule;

type Json = Record<string, unknown>;

interface ResponseSpec {
  content?: { 'application/json'?: { schema: Json } };
  headers?: Record<string, { required?: boolean }>;
  $ref?: string;
}

export interface Operation {
  method: string;
  path: string;
  operationId: string;
  allowAnonymous: boolean;
  public: boolean;
  responses: Record<string, ResponseSpec>;
}

export const HTTP_METHODS = ['get', 'put', 'post', 'patch', 'delete'] as const;

export const openapi = parse(readFileSync(new URL('../../contracts/openapi.yaml', import.meta.url), 'utf8')) as Json;

const ajv = new Ajv2020({ strict: false, validateSchema: false, allErrors: true });
addFormats(ajv);
const OPENAPI_ID = 'https://contract.wang-raan.invalid/openapi.json';
ajv.addSchema(openapi, OPENAPI_ID);

function resolve<T>(node: T & { $ref?: string }): T {
  if (!node.$ref) return node;
  const target = node.$ref
    .replace(/^#\//, '')
    .split('/')
    .reduce<unknown>((current, key) => (current as Json)[key], openapi);
  return resolve(target as T & { $ref?: string });
}

export function operations(): Operation[] {
  const paths = openapi.paths as Record<string, Record<string, Json>>;
  const globalSecurity = openapi.security as unknown[];
  const result: Operation[] = [];

  for (const [path, item] of Object.entries(paths)) {
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (!operation) continue;
      const security = (operation.security as unknown[] | undefined) ?? globalSecurity;
      result.push({
        method: method.toUpperCase(),
        path,
        operationId: operation.operationId as string,
        allowAnonymous: operation['x-allow-anonymous'] === true,
        public: security.length === 0,
        responses: operation.responses as Record<string, ResponseSpec>,
      });
    }
  }
  return result;
}

const validators = new Map<string, ValidateFunction>();

function validatorFor(schema: Json, cacheKey: string): ValidateFunction {
  let validate = validators.get(cacheKey);
  if (!validate) {
    // อ้างอิง schema ภายในเอกสาร OpenAPI ด้วย URI แบบ absolute เพื่อให้ $ref ซ้อนกันทำงาน
    const pointer = (schema as { $ref?: string }).$ref;
    validate = pointer ? ajv.compile({ $ref: `${OPENAPI_ID}${pointer}` }) : ajv.compile(rewriteRefs(schema));
    validators.set(cacheKey, validate);
  }
  return validate;
}

/** schema แบบ inline ใน path อ้าง `#/components/...` — ชี้ให้ไปที่เอกสาร openapi */
function rewriteRefs(node: unknown): Json {
  if (Array.isArray(node)) return node.map(rewriteRefs) as unknown as Json;
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) =>
        key === '$ref' && typeof value === 'string' ? [key, `${OPENAPI_ID}${value}`] : [key, rewriteRefs(value)],
      ),
    );
  }
  return node as Json;
}

export function findOperation(method: string, path: string): Operation {
  const operation = operations().find((candidate) => candidate.method === method && candidate.path === path);
  if (!operation) throw new Error(`${method} ${path} is not in the contract`);
  return operation;
}

/**
 * ตรวจ response จริงกับสัญญา: status ต้องประกาศไว้ (หรืออยู่ในกลุ่ม 5XX),
 * body ต้องผ่าน JSON Schema และ header บังคับต้องมี — คืนรายการปัญหา (ว่าง = ผ่าน)
 */
export function contractViolations(operation: Operation, response: LightMyRequestResponse): string[] {
  const status = String(response.statusCode);
  const raw = operation.responses[status] ?? (status.startsWith('5') ? operation.responses['5XX'] : undefined);
  if (!raw) return [`status ${status} is not documented for ${operation.operationId}`];

  const spec = resolve(raw);
  const problems: string[] = [];
  const schema = spec.content?.['application/json']?.schema;

  if (schema) {
    let body: unknown;
    try {
      body = response.json();
    } catch {
      return [`${operation.operationId} ${status}: body is not JSON`];
    }
    const validate = validatorFor(schema, `${operation.operationId}:${status}`);
    if (!validate(body)) {
      problems.push(`${operation.operationId} ${status}: ${ajv.errorsText(validate.errors)}`);
    }
  } else if (response.body !== '') {
    problems.push(`${operation.operationId} ${status}: expected an empty body`);
  }

  for (const [name, header] of Object.entries(spec.headers ?? {})) {
    if (header.required && response.headers[name.toLowerCase()] === undefined) {
      problems.push(`${operation.operationId} ${status}: missing required header ${name}`);
    }
  }
  return problems;
}

/** `/v1/layouts/{layoutId}` → `/v1/layouts/:layoutId` */
export function toFastifyPath(path: string): string {
  return path.replace(/\{(\w+)\}/g, ':$1');
}
