import { Redis } from "ioredis";
import { env } from "../config/env.js";

let client: Redis | undefined;

export function redis(): Redis {
  // maxRetriesPerRequest: null is required by BullMQ workers.
  client ??= new Redis(env().REDIS_URL, { maxRetriesPerRequest: null });
  return client;
}
