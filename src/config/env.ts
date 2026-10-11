import { z } from 'zod';

const EnvSchema = z.object({
  INTERNAL_TOKEN_SECRET: z.string().min(32, 'INTERNAL_TOKEN_SECRET must be at least 32 characters'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface AppConfig {
  internalTokenSecret: string;
  logLevel: z.infer<typeof EnvSchema>['LOG_LEVEL'];
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
  };
}
