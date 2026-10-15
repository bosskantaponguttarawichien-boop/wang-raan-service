import { readFileSync } from 'node:fs';
import { z } from 'zod';

/** ตัวแปรที่ตั้งเป็นค่าว่าง (เช่น `${VAR:-}` ใน compose) ถือว่าไม่ได้ตั้ง */
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const EnvSchema = z.object({
  INTERNAL_TOKEN_SECRET: z.string().min(32, 'INTERNAL_TOKEN_SECRET must be at least 32 characters'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_VERSION: optional(z.string().trim().min(1).max(64)),
  CONTACT_WEBHOOK_URL: optional(z.string().url()),
  NODE_ENV: optional(z.string()),
  /** ส่งรหัส OTP ทางอีเมลผ่าน Resend — ไม่ตั้ง = ส่งเมลไม่ได้ (production ตอบ 503 ที่ otp/request) */
  RESEND_API_KEY: optional(z.string().min(1)),
  MAIL_FROM: optional(z.string().min(3).max(320)),
  /** รหัส OTP คงที่สำหรับ E2E เท่านั้น — ห้ามตั้งใน production (ระบบไม่ยอมเริ่ม) */
  OTP_TEST_CODE: optional(z.string().regex(/^\d{6}$/, 'OTP_TEST_CODE must be 6 digits')),
});

/** เวอร์ชันจาก package.json — path เดียวกันทั้งจาก src/config และ dist/config */
function packageVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const version = (manifest as { version?: unknown }).version;
  return typeof version === 'string' ? version : 'unknown';
}

export interface AppConfig {
  internalTokenSecret: string;
  logLevel: z.infer<typeof EnvSchema>['LOG_LEVEL'];
  /** เวอร์ชันที่ deploy อยู่ (`GET /health`) — ตั้ง `APP_VERSION` ตอน deploy หรือใช้ค่าจาก package.json */
  version: string;
  /** Discord/Slack incoming webhook สำหรับแจ้งเตือนข้อความติดต่อ — null = ไม่แจ้งเตือน */
  contactWebhookUrl: string | null;
  production: boolean;
  /** ช่องทางส่งรหัส OTP — null = ยังไม่ได้ตั้งค่า */
  mail: { resendApiKey: string; from: string } | null;
  /** รหัส OTP คงที่ (E2E นอก production เท่านั้น) */
  otpTestCode: string | null;
}

/** อ่านและตรวจ environment ตอนเริ่มระบบ — ค่าไม่ครบให้ล้มทันทีแทนที่จะไปพังตอนรับคำขอ */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);

  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration: ${problems.join('; ')}`);
  }

  const production = parsed.data.NODE_ENV === 'production';
  if (production && parsed.data.OTP_TEST_CODE) {
    throw new Error('Invalid environment configuration: OTP_TEST_CODE must not be set in production');
  }
  if (parsed.data.RESEND_API_KEY && !parsed.data.MAIL_FROM) {
    throw new Error('Invalid environment configuration: MAIL_FROM is required with RESEND_API_KEY');
  }

  return {
    internalTokenSecret: parsed.data.INTERNAL_TOKEN_SECRET,
    logLevel: parsed.data.LOG_LEVEL,
    version: parsed.data.APP_VERSION ?? packageVersion(),
    contactWebhookUrl: parsed.data.CONTACT_WEBHOOK_URL ?? null,
    production,
    mail:
      parsed.data.RESEND_API_KEY && parsed.data.MAIL_FROM
        ? { resendApiKey: parsed.data.RESEND_API_KEY, from: parsed.data.MAIL_FROM }
        : null,
    otpTestCode: parsed.data.OTP_TEST_CODE ?? null,
  };
}
