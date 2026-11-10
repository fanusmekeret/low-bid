import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { scheduleClose } from "../../jobs/queues.js";
import { realtime } from "../../sockets/realtime.js";
import { notify } from "../notifications/service.js";
import { getSetting } from "../settings/service.js";
import { AppError, notFound } from "../../utils/errors.js";
import { bidderAlias } from "../../utils/mask.js";
import { formatMinor, money } from "../../utils/money.js";
import { evaluateBid, type LockedAuction } from "./rules.js";

const MESSAGES: Record<string, string> = {
  AUCTION_NOT_LIVE: "This auction is not open for bidding",
  AUCTION_ENDED: "This auction has ended",
  SELLER_CANNOT_BID: "You cannot bid on your own item",
  ALREADY_LEADING: "You are already the highest bidder",
  BIDDER_SUSPENDED: "Your account cannot bid right now",
  DEPOSIT_REQUIRED: "This auction requires a bid deposit",
  BID_TOO_LOW: "Your bid is below the minimum",
};

interface LockedRow {
  id: bigint;
  status: string;
  start_price: bigint;
  min_increment: bigint;
  current_price: bigint | null;
  current_winner_id: bigint | null;
  ends_at: Date;
  extension_count: number;
  deposit_minor: bigint;
  product_id: bigint;
  db_now: Date;
}

function bidView(b: { id: bigint; auctionId: bigint; amount: bigint; createdAt: Date }, extra: Record<string, unknown> = {}) {
  return { id: b.id.toString(), auction_id: b.auctionId.toString(), ...money(b.amount), created_at: b.createdAt.toISOString(), ...extra };
}

export async function placeBid(input: { auctionId: bigint; bidderId: bigint; amount: bigint; idempotencyKey: string; ip?: string }) {
  // Safe retry: the same key returns the original bid unchanged.
  const prior = await prisma.bid.findUnique({
    where: { auctionId_idempotencyKey: { auctionId: input.auctionId, idempotencyKey: input.idempotencyKey } },
  });
  if (prior) {
    if (prior.bidderId !== input.bidderId) throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "Use a new idempotency key");
    return { bid: bidView(prior), replayed: true };
  }

  const [windowSec, maxExt] = await Promise.all([
    getSetting("anti_sniping_window_sec"),
    getSetting("anti_sniping_max_extensions"),
  ]);

  let outcome;
  try {
    outcome = await prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<LockedRow[]>`
          SELECT id, status, start_price, min_increment, current_price, current_winner_id, ends_at,
                 extension_count, deposit_minor, product_id, NOW(3) AS db_now
          FROM auctions WHERE id = ${input.auctionId} FOR UPDATE`;
        const row = rows[0];
        if (!row) throw notFound("Auction");

        const [product, bidder] = await Promise.all([
          tx.product.findUniqueOrThrow({ where: { id: row.product_id }, select: { sellerId: true, title: true } }),
          tx.user.findUniqueOrThrow({ where: { id: input.bidderId }, select: { status: true, fullName: true } }),
        ]);

        const locked: LockedAuction = {
          status: row.status,
          startPrice: BigInt(row.start_price),
          minIncrement: BigInt(row.min_increment),
          currentPrice: row.current_price === null ? null : BigInt(row.current_price),
          currentWinnerId: row.current_winner_id === null ? null : BigInt(row.current_winner_id),
          endsAt: row.ends_at,
          extensionCount: Number(row.extension_count),
          depositMinor: BigInt(row.deposit_minor),
        };

        const decision = evaluateBid({
          auction: locked,
          sellerId: product.sellerId,
          bidderId: input.bidderId,
          bidderStatus: bidder.status,
          amount: input.amount,
          now: row.db_now,
          // TODO(phase 5): deposits are held through Chapa; until then auctions with a deposit refuse bids.
          depositHeld: false,
          antiSnipingWindowSec: windowSec,
          maxExtensions: maxExt,
        });
        if (!decision.ok) {
          throw new AppError(422, decision.code, MESSAGES[decision.code], decision.minAcceptable !== undefined ? { min_acceptable: money(decision.minAcceptable) } : undefined);
        }

        const bid = await tx.bid.create({
          data: { auctionId: input.auctionId, bidderId: input.bidderId, amount: input.amount, idempotencyKey: input.idempotencyKey, ip: input.ip, createdAt: row.db_now },
        });
        const updated = await tx.auction.update({
          where: { id: input.auctionId },
          data: {
            currentPrice: input.amount,
            currentWinnerId: input.bidderId,
            bidCount: { increment: 1 },
            version: { increment: 1 },
            ...(decision.newEndsAt ? { endsAt: decision.newEndsAt, extensionCount: { increment: 1 } } : {}),
          },
        });
        return { bid, updated, previousLeader: locked.currentWinnerId, extended: decision.newEndsAt, alias: bidderAlias(bidder.fullName, input.bidderId), title: product.title };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10_000 },
    );
  } catch (err) {
    // Two retries with the same key racing: the unique index rejects the second; return the first.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const again = await prisma.bid.findUnique({
        where: { auctionId_idempotencyKey: { auctionId: input.auctionId, idempotencyKey: input.idempotencyKey } },
      });
      if (again && again.bidderId === input.bidderId) return { bid: bidView(again), replayed: true };
    }
    throw err;
  }

  // Broadcast only after commit.
  const { bid, updated, previousLeader, extended, alias, title } = outcome;
  const room = realtime().to(`auction:${input.auctionId}`);
  room.emit("auction:bid", {
    auctionId: input.auctionId.toString(),
    amount_minor: bid.amount.toString(),
    bidderAlias: alias,
    bidCount: updated.bidCount,
    endsAt: updated.endsAt.toISOString(),
    serverTime: Date.now(),
  });
  if (extended) {
    room.emit("auction:extended", { auctionId: input.auctionId.toString(), endsAt: extended.toISOString(), serverTime: Date.now() });
    await scheduleClose(input.auctionId, extended);
  }
  if (previousLeader !== null && previousLeader !== input.bidderId) {
    realtime().to(`user:${previousLeader}`).emit("user:outbid", { auctionId: input.auctionId.toString(), amount_minor: bid.amount.toString() });
    await notify(previousLeader, "OUTBID", "You've been outbid", `New highest bid on "${title}" is ${formatMinor(bid.amount)} ETB`, {
      auctionId: input.auctionId.toString(),
    });
  }

  return { bid: bidView(bid, { ends_at: updated.endsAt.toISOString(), bid_count: updated.bidCount }), replayed: false };
}
