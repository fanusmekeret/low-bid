import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { env } from '../config/env.js';
import { getRedis } from '../config/redis.js';

function store(prefix) {
  // Tests and local runs without Redis use the in-memory store; production shares limits across processes.
  if (env.isTest) return undefined;
  const redis = getRedis();
  return new RedisStore({ prefix: `rl:${prefix}:`, sendCommand: (...args) => redis.call(...args) });
}

const handler = (_req, res, _next, options) =>
  res.status(options.statusCode).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' } });

function limiter(prefix, { windowMs, limit, keyGenerator }) {
  return rateLimit({
    windowMs,
    limit: env.isTest ? limit * 100 : limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: store(prefix),
    keyGenerator,
    handler,
  });
}

const ipKey = (req) => ipKeyGenerator(req.ip);

/** Whole API: 300 requests / minute / IP. */
export const globalLimiter = limiter('global', { windowMs: 60_000, limit: 300, keyGenerator: ipKey });

/** Login: 5 attempts / 15 minutes per phone + IP. */
export const loginLimiter = limiter('login', {
  windowMs: 15 * 60_000,
  limit: 5,
  keyGenerator: (req) => `${ipKey(req)}:${String(req.body?.phone ?? '').replace(/\D/g, '').slice(-9)}`,
});

/** Registration and password-reset requests: 10 / hour / IP. */
export const signupLimiter = limiter('signup', { windowMs: 60 * 60_000, limit: 10, keyGenerator: ipKey });

/** Photo and document uploads: 60 requests / hour / IP. */
export const uploadLimiter = limiter('upload', { windowMs: 60 * 60_000, limit: 60, keyGenerator: ipKey });

/** OTP verification: 10 / 15 minutes / IP (per-code attempts are also capped in the database). */
export const otpVerifyLimiter = limiter('otp-verify', { windowMs: 15 * 60_000, limit: 10, keyGenerator: ipKey });
