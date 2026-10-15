import { z } from 'zod';
import type { ShareLink } from '../shares/shares.schemas.js';
import type { StoredLayout } from '../layouts/layouts.schemas.js';
import type { AuthProvider } from './users.repository.js';

export const AuthProviderSchema = z.enum(['guest', 'google', 'line', 'github', 'email']);

/** PUT /v1/me — อัปเดตอย่างเดียว ส่งเฉพาะช่องที่จะแก้ (provider Backend ตั้งเองตอน resolve/verify) */
export const UpdateProfileRequestSchema = z
  .object({
    name: z.string().max(200).nullable().optional(),
    email: z.string().email().max(254).nullable().optional(),
    image: z.string().url().max(2048).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'at least one field is required' });

export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;

export const MergeGuestRequestSchema = z
  .object({
    guestId: z.string().regex(/^guest-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
  })
  .strict();

/** ตรงกับ `components.schemas.User` */
export interface User {
  id: string;
  provider: AuthProvider;
  name: string | null;
  email: string | null;
  image: string | null;
  createdAt: string;
  updatedAt: string;
}

/** ตรงกับ `components.schemas.AccountExport` */
/** ตรงกับ `components.schemas.Identity` */
export interface Identity {
  provider: Exclude<AuthProvider, 'guest'>;
  providerAccountId: string;
  email: string | null;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string;
}

export interface AccountExport {
  exportedAt: string;
  user: User;
  identities: Identity[];
  layouts: StoredLayout[];
  shares: ShareLink[];
  contactMessages: { name: string; email: string; message: string; receivedAt: string }[];
}

/** ตรงกับ `components.schemas.MergeGuestResult` */
export interface MergeGuestResult {
  movedLayouts: number;
  movedShares: number;
  renamed: { from: string; to: string }[];
}
