import { z } from 'zod';

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
    CORS_ORIGINS: z.string().default(''),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
    // Background jobs (auction start/close, reminders). The API runs them in-process by default;
    // set RUN_WORKERS=false and start `bun run worker` separately to split them out.
    RUN_WORKERS: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
    JOBS_ENABLED: z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true')),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

    OTP_PEPPER: z.string().min(32, 'OTP_PEPPER must be at least 32 characters'),
    OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().nonnegative().default(60),
    OTP_MAX_PER_10_MIN: z.coerce.number().int().positive().default(3),

    SMS_PROVIDER: z.enum(['console', 'ethiotelecom']).default('console'),
    ETHIOTELECOM_SMS_URL: optionalString,
    ETHIOTELECOM_SMS_USERNAME: optionalString,
    ETHIOTELECOM_SMS_PASSWORD: optionalString,
    ETHIOTELECOM_SMS_SENDER_ID: z.string().default('LOWBID'),

    SUPER_ADMIN_PHONE: optionalString,
    SUPER_ADMIN_PASSWORD: optionalString,
    SUPER_ADMIN_FIRST_NAME: z.string().default('Super'),
    SUPER_ADMIN_LAST_NAME: z.string().default('Admin'),

    // File storage: "local" keeps files on this server's disk; "s3" uses any S3-compatible bucket
    // (Backblaze B2, Wasabi, Cloudflare R2, MinIO).
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./storage'),
    PUBLIC_MEDIA_BASE_URL: optionalString, // default: `${API_PUBLIC_URL}/media`
    S3_ENDPOINT: optionalString,
    S3_REGION: z.string().default('us-east-1'),
    S3_PUBLIC_BUCKET: optionalString,
    S3_PRIVATE_BUCKET: optionalString,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    UPLOAD_MAX_FILE_MB: z.coerce.number().int().min(1).max(25).default(8),

    CHAPA_SECRET_KEY: optionalString,
    CHAPA_WEBHOOK_SECRET: optionalString,
    CHAPA_BASE_URL: z.string().url().default('https://api.chapa.co/v1'),
    // Where Chapa sends the buyer's browser after paying. Default: this API's return page.
    CHAPA_RETURN_URL: optionalString,
    // Refuse test-mode payments. Defaults to true in production.
    CHAPA_EXPECT_LIVE: z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true')),
    // The app link the return page opens, e.g. lowbid://payments
    APP_DEEP_LINK: z.string().default('lowbid://payments'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.SMS_PROVIDER === 'console') {
      ctx.addIssue({ code: 'custom', path: ['SMS_PROVIDER'], message: 'console SMS is not allowed in production' });
    }
    if (env.NODE_ENV === 'production') {
      for (const key of ['CHAPA_SECRET_KEY', 'CHAPA_WEBHOOK_SECRET']) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required in production` });
      }
      if (env.CHAPA_SECRET_KEY?.includes('TEST')) ctx.addIssue({ code: 'custom', path: ['CHAPA_SECRET_KEY'], message: 'Use the live Chapa key in production' });
    }
    if (env.STORAGE_DRIVER === 's3') {
      for (const key of ['S3_ENDPOINT', 'S3_PUBLIC_BUCKET', 'S3_PRIVATE_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'PUBLIC_MEDIA_BASE_URL']) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when STORAGE_DRIVER=s3` });
      }
    }
    if (env.SMS_PROVIDER === 'ethiotelecom') {
      for (const key of ['ETHIOTELECOM_SMS_URL', 'ETHIOTELECOM_SMS_USERNAME', 'ETHIOTELECOM_SMS_PASSWORD']) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required for ethiotelecom SMS` });
      }
    }
  });

function load() {
  const source = { ...process.env };
  // Integration tests run against their own database.
  if (source.NODE_ENV === 'test' && source.TEST_DATABASE_URL) source.DATABASE_URL = source.TEST_DATABASE_URL;

  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${lines.join('\n')}`);
    process.exit(1);
  }
  const env = parsed.data;
  return Object.freeze({
    ...env,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    // Tests call the job handlers directly instead of going through Redis.
    jobsEnabled: env.JOBS_ENABLED ?? env.NODE_ENV !== 'test',
    chapaExpectLive: env.CHAPA_EXPECT_LIVE ?? env.NODE_ENV === 'production',
    chapaReturnUrl: env.CHAPA_RETURN_URL ?? `${env.API_PUBLIC_URL.replace(/\/$/, '')}/api/v1/payments/chapa/return`,
    chapaCallbackUrl: `${env.API_PUBLIC_URL.replace(/\/$/, '')}/api/v1/payments/chapa/callback`,
    corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  });
}

export const env = load();
