import type { Pool, PoolClient } from 'pg';
import { validateLayout } from '@bosskantaponguttarawichien-boop/wang-raan-core';
import { lockUser, withTransaction } from '../../db/transaction.js';
import { AppError, notFound } from '../../middleware/errors.js';
import * as layouts from '../layouts/layouts.repository.js';
import { MAX_ID_LENGTH } from '../layouts/layouts.schemas.js';
import * as shares from '../shares/shares.repository.js';
import * as repository from './users.repository.js';
import { emailHash } from '../auth/email.js';
import { emailsOfUser, listIdentities } from '../auth/identities.repository.js';
import { deleteOtps } from '../auth/otp.repository.js';
import { MergeGuestRequestSchema, UpdateProfileRequestSchema } from './users.schemas.js';
import type { AccountExport, MergeGuestResult, User } from './users.schemas.js';

const RENAME_SUFFIX = '-guest-copy';

/**
 * หา id ใหม่ที่ไม่ชนกับ `taken`: `<id>-guest-copy`, `<id>-guest-copy-2`, ...
 * ตัด id เดิมให้สั้นลงเมื่อจำเป็นเพื่อให้ไม่เกิน 128 ตัวอักษร
 */
export function nextFreeId(id: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n += 1) {
    const suffix = n === 1 ? RENAME_SUFFIX : `${RENAME_SUFFIX}-${n}`;
    const candidate = `${id.slice(0, MAX_ID_LENGTH - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** ล็อกผู้ใช้สองคนตามลำดับ id เสมอ — กัน deadlock เมื่อมีสอง transaction ล็อกสลับกัน */
async function lockUsers(client: PoolClient, ...userIds: string[]): Promise<void> {
  for (const userId of [...userIds].sort()) await lockUser(client, userId);
}

export class UsersService {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(userId: string): Promise<User> {
    const user = await repository.findUser(this.pool, userId);
    if (!user) throw notFound('user not found');
    return user;
  }

  /** อัปเดตโปรไฟล์อย่างเดียว — บัญชีเกิดจาก resolve / otp verify เท่านั้น (ไม่มี → 404) */
  async update(userId: string, body: unknown): Promise<User> {
    const profile = UpdateProfileRequestSchema.parse(body);
    const user = await repository.updateProfile(this.pool, userId, profile);
    if (!user) throw notFound('user not found');
    return user;
  }

  /**
   * PDPA: ลบโปรไฟล์ identities ผัง ลิงก์แชร์ ข้อความติดต่อ รหัส OTP ที่ค้างของอีเมลในบัญชี และตัวนับ rate limit
   * ในคราวเดียว — เรียกซ้ำได้
   */
  async delete(userId: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await lockUser(client, userId);
      const hashes = (await emailsOfUser(client, userId)).map(emailHash);
      await deleteOtps(client, hashes);
      await repository.deleteUser(client, userId);
      await repository.deleteUserRateLimits(
        client,
        userId,
        hashes.map((hash) => `otp:email:${hash}`),
      );
    });
  }

  /** PDPA: ข้อมูลทั้งหมดของผู้ใช้ อ่านใน transaction เดียวเพื่อให้ได้ภาพที่สอดคล้องกัน */
  async export(userId: string): Promise<AccountExport> {
    const now = this.now();

    return withTransaction(this.pool, async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const user = await repository.findUser(client, userId);
      const provider = repository.providerFromUserId(userId);

      return {
        exportedAt: now.toISOString(),
        // ผู้ใช้ที่ยังไม่เคยมีข้อมูลในระบบ — รายงานโปรไฟล์ว่างแทนการสร้างแถวใหม่จากคำขออ่าน
        user: user ?? {
          id: userId,
          provider: provider ?? 'guest',
          name: null,
          email: null,
          image: null,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
        identities: await listIdentities(client, userId),
        layouts: await layouts.listStoredLayouts(client, userId),
        shares: (await shares.listSharesForOwner(client, userId)).map((row) => shares.toShareLink(row, now)),
        contactMessages: await repository.listContactMessagesForUser(client, userId),
      };
    });
  }

  /**
   * ย้ายผัง ลิงก์แชร์ และข้อความติดต่อของ Guest เข้าบัญชีปัจจุบัน แล้วลบบัญชี Guest — ทั้งหมดใน transaction เดียว
   * (สัญญาไม่มี error สำหรับโควตา 200 ผังในขั้นนี้ จึงไม่ปฏิเสธการย้ายแม้รวมแล้วเกิน)
   */
  async mergeGuest(userId: string, body: unknown): Promise<MergeGuestResult> {
    const { guestId } = MergeGuestRequestSchema.parse(body);
    if (repository.isGuestId(userId)) {
      throw new AppError(400, 'INVALID_REQUEST', 'guest accounts cannot merge another guest', {
        details: [{ path: 'guestId', message: 'the authenticated user must not be a guest' }],
      });
    }

    return withTransaction(this.pool, async (client) => {
      await lockUsers(client, userId, guestId);

      const guestLayouts = await layouts.lockLayoutsOfOwner(client, guestId);
      if (guestLayouts.length === 0 && !(await repository.findUser(client, guestId))) {
        return { movedLayouts: 0, movedShares: 0, renamed: [] };
      }

      await repository.ensureUser(client, userId);
      const taken = new Set(await layouts.listLayoutIds(client, userId));
      const renamed: MergeGuestResult['renamed'] = [];

      for (const { layout, validation } of guestLayouts) {
        if (!taken.has(layout.id)) {
          taken.add(layout.id);
          await layouts.moveLayout(client, {
            fromOwner: guestId,
            fromId: layout.id,
            toOwner: userId,
            layout,
            validation,
          });
          continue;
        }

        const newId = nextFreeId(layout.id, taken);
        taken.add(newId);
        renamed.push({ from: layout.id, to: newId });
        // layoutRevision ของ core คำนวณจาก id ด้วย — ต้องตรวจผังที่เปลี่ยน id ใหม่ให้ผลตรวจตรงกับตัวผัง
        const renamedLayout = { ...layout, id: newId };
        await layouts.moveLayout(client, {
          fromOwner: guestId,
          fromId: layout.id,
          toOwner: userId,
          layout: renamedLayout,
          validation: validateLayout(renamedLayout),
        });
      }

      const movedShares = await shares.moveShares(client, guestId, userId, renamed);
      await repository.moveContactMessages(client, guestId, userId);
      await repository.deleteUser(client, guestId);
      await repository.deleteUserRateLimits(client, guestId);

      return { movedLayouts: guestLayouts.length, movedShares, renamed };
    });
  }
}
