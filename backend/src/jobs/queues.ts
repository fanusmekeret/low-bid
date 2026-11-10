import { Queue } from "bullmq";
import { redis } from "../lib/redis.js";

export const AUCTION_QUEUE = "auctions";

let queue: Queue | undefined;
export function auctionQueue(): Queue {
  queue ??= new Queue(AUCTION_QUEUE, { connection: redis() });
  return queue;
}

/**
 * Schedules a close at `endsAt`. Each end time gets its own job id, so an anti-sniping extension just
 * adds a later job; the earlier one fires, sees the auction has not ended yet, and does nothing.
 */
export async function scheduleClose(auctionId: bigint, endsAt: Date) {
  await auctionQueue().add(
    "close",
    { auctionId: auctionId.toString() },
    { jobId: `close-${auctionId}-${endsAt.getTime()}`, delay: Math.max(0, endsAt.getTime() - Date.now()), removeOnComplete: 1000, removeOnFail: 5000, attempts: 5, backoff: { type: "exponential", delay: 2000 } },
  );
}

export async function scheduleStart(auctionId: bigint, startsAt: Date) {
  await auctionQueue().add(
    "start",
    { auctionId: auctionId.toString() },
    { jobId: `start-${auctionId}-${startsAt.getTime()}`, delay: Math.max(0, startsAt.getTime() - Date.now()), removeOnComplete: 1000, removeOnFail: 5000, attempts: 5, backoff: { type: "exponential", delay: 2000 } },
  );
}
