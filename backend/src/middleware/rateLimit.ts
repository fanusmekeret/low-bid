import type { NextFunction, Request, Response } from "express";
import { redis } from "../lib/redis.js";
import { tooMany } from "../utils/errors.js";

/** Fixed-window rate limit in Redis. keyFn picks the bucket (user id, phone+ip, ...). */
export function rateLimit(name: string, limit: number, windowSec: number, keyFn: (req: Request) => string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const key = `rl:${name}:${keyFn(req)}`;
      const count = await redis().incr(key);
      if (count === 1) await redis().expire(key, windowSec);
      next(count > limit ? tooMany() : undefined);
    } catch (err) {
      next(err);
    }
  };
}
