import { Queue } from 'bullmq';
import { env } from '../config/env.js';
import { getRedis } from '../config/redis.js';
import { logger } from '../utils/logger.js';

// Delayed jobs that fire at an auction's exact start and end times.
// Every handler is idempotent and re-checks the database clock, so a duplicate, early or
// late job is harmless. A sweeper every 30 seconds catches anything Redis lost.

export const AUCTION_QUEUE = 'auctions';
export const ENDING_SOON_MINUTES = 15;

let queue;
function getQueue() {
  if (!queue) {
    queue = new Queue(AUCTION_QUEUE, {
      connection: getRedis(),
      defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000, attempts: 5, backoff: { type: 'exponential', delay: 2000 } },
    });
  }
  return queue;
}

const delayUntil = (date) => Math.max(0, new Date(date).getTime() - Date.now());

// BullMQ job ids may not contain ":".
async function add(name, data, { at, jobId }) {
  if (!env.jobsEnabled) return;
  try {
    await getQueue().add(name, data, { delay: delayUntil(at), jobId });
  } catch (err) {
    // The sweeper still catches the auction, at most 30 seconds late.
    logger.error({ err, name, jobId }, 'could not schedule job');
  }
}

export const scheduleAuctionStart = (a) =>
  add('start', { auctionId: String(a.id) }, { at: a.startsAt, jobId: `start-${a.id}-${new Date(a.startsAt).getTime()}` });

/** One job per target time: the close may be retried a little later while late bid fees are confirmed. */
export const scheduleAuctionClose = (a) =>
  add('close', { auctionId: String(a.id) }, { at: a.endsAt, jobId: `close-${a.id}-${new Date(a.endsAt).getTime()}` });

export const scheduleEndingSoon = (a) =>
  add('ending-soon', { auctionId: String(a.id) }, {
    at: new Date(new Date(a.endsAt).getTime() - ENDING_SOON_MINUTES * 60_000),
    jobId: `ending-${a.id}`,
  });

/** All jobs an auction needs for its current status. */
export async function scheduleAuctionJobs(a) {
  if (a.status === 'SCHEDULED') await scheduleAuctionStart(a);
  if (a.status === 'SCHEDULED' || a.status === 'LIVE') {
    await scheduleAuctionClose(a);
    await scheduleEndingSoon(a);
  }
}

// ─── Payments ───

/** The winner's payment deadline: unpaid → strike, then a second-chance offer to the next ranked bidder. */
export const schedulePaymentDeadline = (r) =>
  add('payment-deadline', { resultId: String(r.id) }, { at: r.paymentDeadline, jobId: `deadline-${r.id}-${new Date(r.paymentDeadline).getTime()}` });

export const schedulePaymentReminder = (r, hoursBefore) =>
  hoursBefore > 0 &&
  add('payment-reminder', { resultId: String(r.id) }, {
    at: new Date(new Date(r.paymentDeadline).getTime() - hoursBefore * 3_600_000),
    jobId: `reminder-${r.id}-${new Date(r.paymentDeadline).getTime()}`,
  });

/** Send an approved refund to Chapa now (retried with backoff; the reconcile job also picks it up). */
export const scheduleRefund = (refundId) => add('refund', { refundId: String(refundId) }, { at: new Date(), jobId: `refund-${refundId}-${Date.now()}` });

export async function closeQueue() {
  if (queue) await queue.close();
  queue = undefined;
}

export { getQueue };
