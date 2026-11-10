import { Worker } from "bullmq";
import { env } from "./config/env.js";
import { AUCTION_QUEUE, auctionQueue } from "./jobs/queues.js";
import { redis } from "./lib/redis.js";
import { logger } from "./lib/logger.js";
import { closeAuction, startAuction, sweep } from "./modules/auctions/lifecycle.js";

env(); // fail fast on bad config

/** Separate process so a busy close queue never slows down bidding in the web process. */
const worker = new Worker(
  AUCTION_QUEUE,
  async (job) => {
    switch (job.name) {
      case "start":
        // Job return values are stored as JSON in Redis, so return plain values only.
        return { started: (await startAuction(BigInt(job.data.auctionId))) !== null };
      case "close":
        return { outcome: await closeAuction(BigInt(job.data.auctionId)) };
      case "sweep":
        return sweep();
      default:
        logger.warn({ name: job.name }, "unknown job");
    }
  },
  { connection: redis(), concurrency: 8 },
);

worker.on("failed", (job, err) => logger.error({ job: job?.name, id: job?.id, err }, "job failed"));

await auctionQueue().upsertJobScheduler("sweeper", { every: 30_000 }, { name: "sweep" });
logger.info("LOW BID worker started");

const shutdown = async () => {
  await worker.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
