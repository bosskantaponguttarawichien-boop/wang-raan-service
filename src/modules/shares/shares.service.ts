import type { Pool } from 'pg';
import { migrateLayout } from '@bosskantaponguttarawichien-boop/wang-raan-core';
import { withTransaction } from '../../db/transaction.js';
import { AppError, notFound } from '../../middleware/errors.js';
import { generateShareKey, isShareKey } from '../../services/share-generator.js';
import { findLayout } from '../layouts/layouts.repository.js';
import { isValidId } from '../layouts/layouts.schemas.js';
import { layoutBlocked } from '../layouts/layouts.service.js';
import * as repository from './shares.repository.js';
import {
  CreateShareRequestSchema,
  expiryProblem,
  MAX_ACTIVE_SHARES_PER_LAYOUT,
  shareStatus,
  UpdateShareRequestSchema,
} from './shares.schemas.js';
import type { PublicShare, ShareLink } from './shares.schemas.js';

const layoutNotFound = () => notFound('layout not found');
const shareNotFound = () => notFound('share link not found');
const shareLimitReached = () =>
  new AppError(
    409,
    'SHARE_LIMIT_REACHED',
    `active share link limit of ${MAX_ACTIVE_SHARES_PER_LAYOUT} reached for this layout`,
  );

/** ลิงก์ที่ใช้ไม่ได้แล้วตอบ 410 — revoked มาก่อน expired */
function assertShareUsable(row: { expires_at: Date | null; revoked_at: Date | null }, now: Date): void {
  const status = shareStatus({ expiresAt: row.expires_at, revokedAt: row.revoked_at }, now);
  if (status === 'revoked') throw new AppError(410, 'SHARE_REVOKED', 'share link has been revoked');
  if (status === 'expired') throw new AppError(410, 'SHARE_EXPIRED', 'share link has expired');
}

function parseExpiry(value: string | null | undefined, now: Date): Date | null {
  const expiresAt = value ? new Date(value) : null;
  const problem = expiryProblem(expiresAt, now);
  if (problem) {
    throw new AppError(400, 'INVALID_REQUEST', `expiresAt ${problem}`, {
      details: [{ path: 'expiresAt', message: problem }],
    });
  }
  return expiresAt;
}

export class SharesService {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(ownerId: string, layoutId: string): Promise<ShareLink[]> {
    if (!isValidId(layoutId) || !(await findLayout(this.pool, ownerId, layoutId))) throw layoutNotFound();
    const now = this.now();
    return (await repository.listSharesForLayout(this.pool, ownerId, layoutId)).map((row) =>
      repository.toShareLink(row, now),
    );
  }

  async create(ownerId: string, layoutId: string, body: unknown): Promise<ShareLink> {
    const request = CreateShareRequestSchema.parse(body ?? {});
    const now = this.now();
    const expiresAt = parseExpiry(request.expiresAt, now);
    if (!isValidId(layoutId)) throw layoutNotFound();

    return withTransaction(this.pool, async (client) => {
      // ล็อกแถวผังไว้จนจบ transaction — กันการสร้างพร้อมกันจนเกินโควตา และกันผังถูกลบกลางคัน
      const stored = await findLayout(client, ownerId, layoutId, { forUpdate: true });
      if (!stored) throw layoutNotFound();
      if (stored.validation.status === 'blocked') throw layoutBlocked(stored.validation);

      if ((await repository.countActiveShares(client, ownerId, layoutId)) >= MAX_ACTIVE_SHARES_PER_LAYOUT) {
        throw shareLimitReached();
      }

      const row = await repository.insertShare(client, {
        shareKey: generateShareKey(),
        ownerId,
        layoutId,
        layout: stored.layout,
        validation: stored.validation,
        expiresAt,
      });
      return repository.toShareLink(row, now);
    });
  }

  async updateExpiry(ownerId: string, shareKey: string, body: unknown): Promise<ShareLink> {
    const request = UpdateShareRequestSchema.parse(body);
    const now = this.now();
    const expiresAt = parseExpiry(request.expiresAt, now);
    if (!isShareKey(shareKey)) throw shareNotFound();

    return withTransaction(this.pool, async (client) => {
      const current = await repository.findOwnedShare(client, ownerId, shareKey, { forUpdate: true });
      if (!current) throw shareNotFound();

      const status = shareStatus({ expiresAt: current.expires_at, revokedAt: current.revoked_at }, now);
      if (status === 'revoked') throw new AppError(410, 'SHARE_REVOKED', 'share link has been revoked');
      // ต่ออายุลิงก์ที่หมดอายุ = กลับมาใช้งานได้ จึงนับโควตาเหมือนสร้างใหม่ (ล็อกแถวผังเหมือน create กันเกินโควตาจากคำขอพร้อมกัน)
      if (status === 'expired') {
        await findLayout(client, ownerId, current.layout_id, { forUpdate: true });
        if ((await repository.countActiveShares(client, ownerId, current.layout_id)) >= MAX_ACTIVE_SHARES_PER_LAYOUT) {
          throw shareLimitReached();
        }
      }

      return repository.toShareLink(await repository.updateShareExpiry(client, ownerId, shareKey, expiresAt), now);
    });
  }

  async revoke(ownerId: string, shareKey: string): Promise<void> {
    if (!isShareKey(shareKey) || !(await repository.revokeShare(this.pool, ownerId, shareKey))) {
      throw shareNotFound();
    }
  }

  /** หน้าแชร์สาธารณะ — ใครถือ token ที่ถูกต้อง (รวม anonymous) ก็เปิดได้ */
  async getPublic(shareKey: string): Promise<PublicShare> {
    const row = isShareKey(shareKey) ? await repository.findPublicShare(this.pool, shareKey) : null;
    if (!row) throw shareNotFound();

    assertShareUsable(row, this.now());

    // ประกอบ response ทีละฟิลด์ — ไม่ส่งต่อแถวจาก DB ตรง ๆ เพื่อไม่ให้ฟิลด์อื่นหลุดออกไป
    return {
      // snapshot ที่แชร์ไว้ด้วย core 1.x → รูปแบบปัจจุบัน (kitchenDoor)
      layout: migrateLayout(row.layout),
      validation: row.validation,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at?.toISOString() ?? null,
    };
  }
}
