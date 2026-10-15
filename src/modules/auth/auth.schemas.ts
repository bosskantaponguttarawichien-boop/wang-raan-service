import { z } from 'zod';
import type { User } from '../users/users.schemas.js';

const Email = z.string().email().max(254);

/** สัญญา ResolveIdentityRequest — `provider: email` ไม่รับ (ต้องผ่าน otp/verify) */
export const ResolveIdentityRequestSchema = z.union([
  z.object({ provider: z.literal('guest') }).strict(),
  z
    .object({
      provider: z.enum(['google', 'line', 'github']),
      providerAccountId: z.string().min(1).max(255),
      email: Email.nullable(),
      emailVerified: z.boolean(),
      name: z.string().max(200).nullable().optional(),
      image: z.string().url().max(2048).nullable().optional(),
    })
    .strict(),
]);

export const RequestOtpRequestSchema = z.object({ email: Email }).strict();
export const VerifyOtpRequestSchema = z.object({ email: Email, code: z.string().regex(/^[0-9]{6}$/) }).strict();

export type OAuthProvider = 'google' | 'line' | 'github';
export type IdentityProvider = OAuthProvider | 'email';

/** ตัวตนที่ล็อกอินเข้ามา (OAuth หรืออีเมลที่ยืนยันด้วย OTP แล้ว) */
export interface IdentityInput {
  provider: IdentityProvider;
  providerAccountId: string;
  email: string | null;
  emailVerified: boolean;
  name?: string | null | undefined;
  image?: string | null | undefined;
}

/** ตรงกับ `components.schemas.ResolvedUser` */
export interface ResolvedUser {
  user: User;
  created: boolean;
}

/** ตรงกับ `components.schemas.RequestOtpResponse` */
export interface RequestOtpResponse {
  sent: true;
  expiresIn: number;
}
