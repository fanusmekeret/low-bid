import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  OTP_PEPPER: z.string().min(16),
  CORS_ORIGINS: z.string().default(""),
  CHAPA_SECRET_KEY: z.string().optional(),
  CHAPA_WEBHOOK_SECRET: z.string().optional(),
  PUBLIC_BASE_URL: z.string().default("http://localhost:4000"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validates process.env once at boot; the process refuses to start with bad config. */
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Invalid environment: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}
