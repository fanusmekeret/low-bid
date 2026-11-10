import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { bootstrapSchedules, closeAuction, sendEndingSoon, startAuction, sweep } from '../modules/auctions/lifecycle.service.js';
import { reconcilePayments } from '../modules/payments/payments.service.js';
import { reconcilePayouts } from '../modules/payments/payouts.service.js';
import { processRefund, reconcileRefunds } from '../modules/payments/refunds.service.js';
import { expireUnpaidResult, scheduleResultJobs, sendPaymentReminder } from '../modules/payments/results.service.js';
import { prisma } from '../config/prisma.js';
import { getSetting } from '../modules/settings/settings.service.js';
import { logger } from '../utils/logger.js';
import { AUCTION_QUEUE, getQueue, scheduleAuctionClose, scheduleAuctionStart } from './queue.js';

const SWEEP_EVERY_MS = 30_000;

async function handle(job) {
  const id = job.data?.auctionId;
  switch (job.name) {
    case 'start': {
      const r = await startAuction(id);
      if (r.result === 'not-due') await scheduleAuctionStart({ id, startsAt: r.rescheduleAt });
      if (r.result === 'started') await scheduleAuctionClose(r.auction);
      return r.result;
    }
    case 'close': {
      const r = await closeAuction(id);
      // Extended by a late bid, or the job fired a moment early: try again at the new end.
      if (r.result === 'not-due') await scheduleAuctionClose({ id, endsAt: r.rescheduleAt });
      return r.result;
    }
    case 'ending-soon':
      return (await sendEndingSoon(id)).result;
    case 'sweep':
      return sweep();
    case 'payment-deadline':
      return (await expireUnpaidResult(job.data.resultId)).result;
    case 'payment-reminder':
      return (await sendPaymentReminder(job.data.resultId)).result;
    case 'refund':
      return (await processRefund(job.data.refundId)).result;
    case 'reconcile': {
      // Pending payments, refunds and transfers: ask Chapa where each one stands.
      const [p, r, o] = [await reconcilePayments(), await reconcileRefunds(), await reconcilePayouts()];
      return { payments: p, refunds: r, payouts: o };
    }
    default:
      logger.warn({ name: job.name }, 'unknown job');
      return 'unknown';
  }
}

let worker;

/** Starts the job worker (in the API process or in `bun run worker`). */
export async function startWorkers() {
  if (!env.jobsEnabled || worker) return;
  // Workers block on Redis, so they need their own connection.
  worker = new Worker(AUCTION_QUEUE, handle, {
    connection: new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }),
    concurrency: 8,
  });
  worker.on('failed', (job, err) => logger.error({ err, job: job?.name, id: job?.data?.auctionId }, 'job failed'));

  // One sweep schedule for the whole cluster, however many workers run.
  await getQueue().upsertJobScheduler('auction-sweep', { every: SWEEP_EVERY_MS }, { name: 'sweep' });
  const { reconcileEveryMinutes } = await getSetting('payment.chapa');
  await getQueue().upsertJobScheduler('payment-reconcile', { every: reconcileEveryMinutes * 60_000 }, { name: 'reconcile' });
  await bootstrapSchedules();
  // Payment deadlines for every result still waiting for its winner.
  const awaiting = await prisma.auctionResult.findMany({ where: { status: 'AWAITING_PAYMENT' } });
  for (const r of awaiting) await scheduleResultJobs(r);
  logger.info('auction workers started');
}

export async function stopWorkers() {
  if (worker) await worker.close();
  worker = undefined;
}
