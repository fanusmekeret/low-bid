import http from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { closeRedis } from './config/redis.js';
import { closeQueue } from './jobs/queue.js';
import { startWorkers, stopWorkers } from './jobs/worker.js';
import { flushViews } from './modules/auctions/catalog.service.js';
import { initSockets } from './sockets/index.js';
import { logger } from './utils/logger.js';

const app = createApp();
const server = http.createServer(app);
const io = await initSockets(server);

// Auction start/close jobs run here unless RUN_WORKERS=false (then use `bun run worker`).
if (env.RUN_WORKERS) await startWorkers();

server.listen(env.PORT, () => logger.info({ port: env.PORT, env: env.NODE_ENV, workers: env.RUN_WORKERS }, 'LOW BID API listening'));

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  const force = setTimeout(() => process.exit(1), 15_000).unref();
  io.close();
  server.close(async () => {
    await stopWorkers();
    await flushViews();
    await closeQueue();
    await Promise.allSettled([prisma.$disconnect(), closeRedis()]);
    clearTimeout(force);
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
