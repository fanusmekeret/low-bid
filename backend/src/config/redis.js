import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

let client;

/** Shared Redis connection (rate limits now; BullMQ and Socket.IO adapter later). */
export function getRedis() {
  if (!client) {
    client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, enableOfflineQueue: true, lazyConnect: false });
    client.on('error', (err) => logger.error({ err }, 'redis error'));
  }
  return client;
}

export async function closeRedis() {
  if (client) {
    await client.quit().catch(() => client.disconnect());
    client = undefined;
  }
}
