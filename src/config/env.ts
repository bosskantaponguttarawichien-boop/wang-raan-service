import { readFileSync } from 'node:fs';
import { z } from 'zod';

const EnvSchema = z.object({
  INTERNAL_TOKEN_SECRET: z.string().min(32, 'INTERNAL_TOKEN_SECRET must be at least 32 characters'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_VERSION: z.string().trim().min(1).max(64).optional(),
  CONTACT_WEBHOOK_URL: z.string().url().optional(),
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
}

/** อ่านและตรวจ environment ตอนเริ่มระบบ — ค่าไม่ครบให้ล้มทันทีแทนที่จะไปพังตอนรับคำขอ */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);

  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration: ${problems.join('; ')}`);
  }

  return {
    internalTokenSecret: parsed.data.INTERNAL_TOKEN_SECRET,
    logLevel: parsed.data.LOG_LEVEL,
    version: parsed.data.APP_VERSION ?? packageVersion(),
    contactWebhookUrl: parsed.data.CONTACT_WEBHOOK_URL ?? null,
  };
}
