// Stand-alone job worker: `bun run worker`. Use it with RUN_WORKERS=false on the API when you
// want auction closing and reminders in their own process (or on their own server).
import { prisma } from './config/prisma.js';
import { closeRedis } from './config/redis.js';
import { closeQueue } from './jobs/queue.js';
import { startWorkers, stopWorkers } from './jobs/worker.js';
import { initRealtimeEmitter } from './sockets/index.js';
import { logger } from './utils/logger.js';

await initRealtimeEmitter(); // live events reach clients through Redis
await startWorkers();

async function shutdown(signal) {
  logger.info({ signal }, 'worker shutting down');
  await stopWorkers();
  await closeQueue();
  await Promise.allSettled([prisma.$disconnect(), closeRedis()]);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
