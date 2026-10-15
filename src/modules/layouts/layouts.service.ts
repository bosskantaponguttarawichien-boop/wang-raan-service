import type { Pool } from 'pg';
import type { StoreLayout, ValidationResult } from '@bosskantaponguttarawichien-boop/wang-raan-core';
import { lockUser, withTransaction } from '../../db/transaction.js';
import { AppError, notFound } from '../../middleware/errors.js';
import { PageCursor } from '../../services/page-cursor.js';
import { parseAndValidateLayout } from '../../services/validator.js';
import { revokeSharesForLayout } from '../shares/shares.repository.js';
import { ensureUser } from '../users/users.repository.js';
import * as repository from './layouts.repository.js';
import {
  defaultLayoutName,
  isValidId,
  LayoutNameSchema,
  ListLayoutsQuerySchema,
  MAX_LAYOUTS_PER_USER,
} from './layouts.schemas.js';
import type { LayoutPage, StoredLayout } from './layouts.schemas.js';
import type { PagePosition } from './layouts.repository.js';

const isPagePosition = (value: unknown): value is { u: string; i: string } =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { u?: unknown }).u === 'string' &&
  /^-?\d{1,20}$/.test((value as { u: string }).u) &&
  typeof (value as { i?: unknown }).i === 'string';

/**
 * แยก `name` ออกจาก body ก่อนส่ง `{ layout }` ให้ schema ของ core (core 1.0 ยังไม่รู้จัก name และเป็น strict)
 * name ผิด → 400 INVALID_LAYOUT_SCHEMA เหมือนส่วนอื่นของ body
 */
function splitName(body: unknown): { rest: unknown; name: string | undefined } {
  if (typeof body !== 'object' || body === null || Array.isArray(body) || !('name' in body)) {
    return { rest: body, name: undefined };
  }
  const { name, ...rest } = body as Record<string, unknown>;
  const parsed = LayoutNameSchema.safeParse(name);
  if (!parsed.success) {
    throw new AppError(400, 'INVALID_LAYOUT_SCHEMA', 'name must be 1-80 characters after trimming', {
      details: parsed.error.issues.map((issue) => ({ path: 'name', message: issue.message })),
    });
  }
  return { rest, name: parsed.data };
}

const layoutNotFound = () => notFound('layout not found');

/**
 * ด่านตรวจผังสองชั้น: Zod schema ของ core → `validateLayout()`
 * ผล blocked ต้องหยุดก่อนแตะฐานข้อมูลเสมอ
 */
export function validateForSave(body: unknown): {
  layout: StoreLayout;
  validation: ValidationResult;
  name: string | undefined;
} {
  const { rest, name } = splitName(body);
  const result = parseAndValidateLayout(rest);

  if (!result.success) {
    throw new AppError(400, 'INVALID_LAYOUT_SCHEMA', 'layout does not match StoreLayout schema', {
      details: result.details,
    });
  }

  if (result.validation.status === 'blocked') {
    throw layoutBlocked(result.validation);
  }

  return { layout: result.layout, validation: result.validation, name };
}

export function layoutBlocked(validation: ValidationResult): AppError {
  return new AppError(422, 'LAYOUT_BLOCKED', 'layout has blocking issues', {
    validation,
    issues: validation.issues.filter((issue) => issue.severity === 'blocked'),
  });
}

export class LayoutsService {
  private readonly cursors: PageCursor<{ u: string; i: string }>;

  constructor(
    private readonly pool: Pool,
    cursorSecret: string,
  ) {
    this.cursors = new PageCursor(cursorSecret, 'layouts');
  }

  /** ใหม่สุดก่อน ทีละหน้า — cursor ปลอม/ของคนอื่น → 400 */
  async list(ownerId: string, query: unknown): Promise<LayoutPage> {
    const { limit, cursor } = ListLayoutsQuerySchema.parse(query);
    let after: PagePosition | undefined;
    if (cursor) {
      const position = this.cursors.decode(ownerId, cursor, isPagePosition);
      if (!position) {
        throw new AppError(400, 'INVALID_REQUEST', 'invalid cursor', {
          details: [{ path: 'cursor', message: 'use nextCursor from the previous page' }],
        });
      }
      after = { updatedAtMicros: position.u, id: position.i };
    }
    const page = await repository.listLayoutSummaries(this.pool, ownerId, { limit, after });
    return {
      layouts: page.layouts,
      nextCursor: page.next ? this.cursors.encode(ownerId, { u: page.next.updatedAtMicros, i: page.next.id }) : null,
    };
  }

  async get(ownerId: string, layoutId: string): Promise<StoredLayout> {
    const stored = isValidId(layoutId) ? await repository.findLayout(this.pool, ownerId, layoutId) : null;
    if (!stored) throw layoutNotFound();
    return stored;
  }

  async create(ownerId: string, body: unknown): Promise<StoredLayout> {
    const { layout, validation, name } = validateForSave(body);

    return withTransaction(this.pool, async (client) => {
      await lockUser(client, ownerId);
      await ensureUser(client, ownerId);

      if (await repository.findLayout(client, ownerId, layout.id)) {
        throw new AppError(409, 'LAYOUT_EXISTS', 'layout id already exists; use PUT to overwrite');
      }
      if ((await repository.countLayouts(client, ownerId)) >= MAX_LAYOUTS_PER_USER) {
        throw new AppError(409, 'LAYOUT_LIMIT_REACHED', `layout limit of ${MAX_LAYOUTS_PER_USER} reached`);
      }

      return repository.insertLayout(client, ownerId, layout, validation, name ?? defaultLayoutName(layout));
    });
  }

  async update(ownerId: string, layoutId: string, body: unknown): Promise<StoredLayout> {
    const { rest, name } = splitName(body);
    const result = parseAndValidateLayout(rest);
    if (!result.success) {
      throw new AppError(400, 'INVALID_LAYOUT_SCHEMA', 'layout does not match StoreLayout schema', {
        details: result.details,
      });
    }
    if (result.layout.id !== layoutId) {
      throw new AppError(400, 'ID_MISMATCH', 'layout.id does not match layoutId in path', {
        details: [{ path: 'layout.id', message: `expected "${layoutId}"` }],
      });
    }
    if (result.validation.status === 'blocked') throw layoutBlocked(result.validation);

    const stored = await repository.updateLayout(this.pool, ownerId, result.layout, result.validation, name);
    if (!stored) throw layoutNotFound();
    return stored;
  }

  async delete(ownerId: string, layoutId: string): Promise<void> {
    if (!isValidId(layoutId)) throw layoutNotFound();

    await withTransaction(this.pool, async (client) => {
      if (!(await repository.deleteLayout(client, ownerId, layoutId))) throw layoutNotFound();
      await revokeSharesForLayout(client, ownerId, layoutId);
    });
  }
}
