import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { scheduleClose } from "../../jobs/queues.js";
import { realtime } from "../../sockets/realtime.js";
import { bidderAlias } from "../../utils/mask.js";
import { formatMinor } from "../../utils/money.js";
import { notify } from "../notifications/service.js";
import { getSetting } from "../settings/service.js";

interface Row {
  id: bigint;
  status: string;
  starts_at: Date;
  ends_at: Date;
  current_price: bigint | null;
  current_winner_id: bigint | null;
  reserve_price: bigint | null;
  bid_count: number;
  product_id: bigint;
  db_now: Date;
}

async function lock(tx: Prisma.TransactionClient, id: bigint) {
  const rows = await tx.$queryRaw<Row[]>`
    SELECT id, status, starts_at, ends_at, current_price, current_winner_id, reserve_price, bid_count, product_id,
           NOW(3) AS db_now
    FROM auctions WHERE id = ${id} FOR UPDATE`;
  return rows[0];
}

/** SCHEDULED → LIVE once starts_at has passed. Idempotent. */
export async function startAuction(id: bigint) {
  const started = await prisma.$transaction(async (tx) => {
    const row = await lock(tx, id);
    if (!row || row.status !== "SCHEDULED" || row.db_now < row.starts_at) return null;
    return tx.auction.update({ where: { id }, data: { status: "LIVE" } });
  });
  if (started) {
    await scheduleClose(id, started.endsAt);
    realtime().to(`auction:${id}`).emit("auction:started", { auctionId: id.toString(), endsAt: started.endsAt.toISOString(), serverTime: Date.now() });
  }
  return started;
}

export type CloseOutcome = "CLOSED" | "NO_SALE" | "NOT_DUE" | "SKIPPED";

/**
 * Closes a LIVE auction whose end has passed. Idempotent and safe to call from both the delayed job
 * and the sweeper. If a late bid extended the auction, it reschedules instead of closing.
 */
export async function closeAuction(id: bigint): Promise<CloseOutcome> {
  const timeoutHours = await getSetting("payment_timeout_hours");

  const result = await prisma.$transaction(async (tx) => {
    const row = await lock(tx, id);
    if (!row || row.status !== "LIVE") return { outcome: "SKIPPED" as const };
    if (row.db_now < row.ends_at) return { outcome: "NOT_DUE" as const, endsAt: row.ends_at };

    const price = row.current_price === null ? null : BigInt(row.current_price);
    const reserve = row.reserve_price === null ? null : BigInt(row.reserve_price);
    const sold = Number(row.bid_count) > 0 && price !== null && (reserve === null || price >= reserve);

    if (!sold) {
      await tx.auction.update({ where: { id }, data: { status: "NO_SALE" } });
      await tx.auctionResult.create({ data: { auctionId: id, status: "NO_SALE", finalPrice: price } });
      return { outcome: "NO_SALE" as const, productId: row.product_id };
    }

    const winnerId = BigInt(row.current_winner_id!);
    const deadline = new Date(row.db_now.getTime() + timeoutHours * 3600 * 1000);
    await tx.auction.update({ where: { id }, data: { status: "CLOSED" } });
    await tx.auctionResult.create({
      data: { auctionId: id, winnerId, finalPrice: price, status: "AWAITING_PAYMENT", paymentDeadline: deadline },
    });
    const winner = await tx.user.findUniqueOrThrow({ where: { id: winnerId }, select: { fullName: true } });
    return { outcome: "CLOSED" as const, winnerId, price: price!, deadline, alias: bidderAlias(winner.fullName, winnerId), productId: row.product_id };
  });

  if (result.outcome === "NOT_DUE") {
    await scheduleClose(id, result.endsAt);
    return "NOT_DUE";
  }
  if (result.outcome === "SKIPPED") return "SKIPPED";

  const product = await prisma.product.findUnique({ where: { id: result.productId }, select: { title: true, sellerId: true } });
  const room = realtime().to(`auction:${id}`);

  if (result.outcome === "NO_SALE") {
    room.emit("auction:closed", { auctionId: id.toString(), status: "NO_SALE", finalAmount_minor: null, winnerAlias: null });
    if (product) await notify(product.sellerId, "AUCTION_NO_SALE", "Auction ended without a sale", `"${product.title}" ended with no winning bid.`, { auctionId: id.toString() });
    logger.info({ auctionId: id.toString() }, "auction closed: no sale");
    return "NO_SALE";
  }

  room.emit("auction:closed", { auctionId: id.toString(), status: "CLOSED", finalAmount_minor: result.price.toString(), winnerAlias: result.alias });
  realtime().to(`user:${result.winnerId}`).emit("user:won", { auctionId: id.toString(), paymentDeadline: result.deadline.toISOString() });
  await notify(result.winnerId, "AUCTION_WON", "You won!", `You won "${product?.title}" for ${formatMinor(result.price)} ETB. Pay before the deadline.`, {
    auctionId: id.toString(),
    paymentDeadline: result.deadline.toISOString(),
  });
  if (product) await notify(product.sellerId, "AUCTION_SOLD", "Your item sold", `"${product.title}" sold for ${formatMinor(result.price)} ETB.`, { auctionId: id.toString() });
  logger.info({ auctionId: id.toString() }, "auction closed: sold");
  return "CLOSED";
}

/** Safety net run every 30 s: starts due auctions and closes overdue ones in case Redis lost a job. */
export async function sweep() {
  const [due, overdue] = await Promise.all([
    prisma.$queryRaw<{ id: bigint }[]>`SELECT id FROM auctions WHERE status = 'SCHEDULED' AND starts_at <= NOW(3) LIMIT 200`,
    prisma.$queryRaw<{ id: bigint }[]>`SELECT id FROM auctions WHERE status = 'LIVE' AND ends_at <= NOW(3) LIMIT 200`,
  ]);
  for (const { id } of due) await startAuction(BigInt(id));
  for (const { id } of overdue) await closeAuction(BigInt(id));
  return { started: due.length, closed: overdue.length };
}
