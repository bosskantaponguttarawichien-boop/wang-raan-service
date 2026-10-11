import type { Pool } from 'pg';
import type { StoreLayout, ValidationResult } from '@bosskantaponguttarawichien-boop/wang-raan-core';
import { lockUser, withTransaction } from '../../db/transaction.js';
import { AppError, notFound } from '../../middleware/errors.js';
import { parseAndValidateLayout } from '../../services/validator.js';
import { revokeSharesForLayout } from '../shares/shares.repository.js';
import { ensureUser } from '../users/users.repository.js';
import * as repository from './layouts.repository.js';
import { isValidId, MAX_LAYOUTS_PER_USER } from './layouts.schemas.js';
import type { LayoutSummary, StoredLayout } from './layouts.schemas.js';

const layoutNotFound = () => notFound('layout not found');

/**
 * ด่านตรวจผังสองชั้น: Zod schema ของ core → `validateLayout()`
 * ผล blocked ต้องหยุดก่อนแตะฐานข้อมูลเสมอ
 */
export function validateForSave(body: unknown): { layout: StoreLayout; validation: ValidationResult } {
  const result = parseAndValidateLayout(body);

  if (!result.success) {
    throw new AppError(400, 'INVALID_LAYOUT_SCHEMA', 'layout does not match StoreLayout schema', {
      details: result.details,
    });
  }

  if (result.validation.status === 'blocked') {
    throw layoutBlocked(result.validation);
  }

  return { layout: result.layout, validation: result.validation };
}

export function layoutBlocked(validation: ValidationResult): AppError {
  return new AppError(422, 'LAYOUT_BLOCKED', 'layout has blocking issues', {
    validation,
    issues: validation.issues.filter((issue) => issue.severity === 'blocked'),
  });
}

export class LayoutsService {
  constructor(private readonly pool: Pool) {}

  list(ownerId: string): Promise<LayoutSummary[]> {
    return repository.listLayoutSummaries(this.pool, ownerId);
  }

  async get(ownerId: string, layoutId: string): Promise<StoredLayout> {
    const stored = isValidId(layoutId) ? await repository.findLayout(this.pool, ownerId, layoutId) : null;
    if (!stored) throw layoutNotFound();
    return stored;
  }

  async create(ownerId: string, body: unknown): Promise<StoredLayout> {
    const { layout, validation } = validateForSave(body);

    return withTransaction(this.pool, async (client) => {
      await lockUser(client, ownerId);
      await ensureUser(client, ownerId);

      if (await repository.findLayout(client, ownerId, layout.id)) {
        throw new AppError(409, 'LAYOUT_EXISTS', 'layout id already exists; use PUT to overwrite');
      }
      if ((await repository.countLayouts(client, ownerId)) >= MAX_LAYOUTS_PER_USER) {
        throw new AppError(409, 'LAYOUT_LIMIT_REACHED', `layout limit of ${MAX_LAYOUTS_PER_USER} reached`);
      }

      return repository.insertLayout(client, ownerId, layout, validation);
    });
  }

  async update(ownerId: string, layoutId: string, body: unknown): Promise<StoredLayout> {
    const result = parseAndValidateLayout(body);
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

    const stored = await repository.updateLayout(this.pool, ownerId, result.layout, result.validation);
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
