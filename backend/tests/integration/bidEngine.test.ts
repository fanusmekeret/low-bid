/**
 * Runs against a real MySQL 8 + Redis (docker compose up, prisma migrate, then RUN_DB_TESTS=1 npm test).
 * Proves the row lock serialises concurrent bids and that closing is correct and idempotent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ulid } from "ulid";
import { prisma } from "../../src/lib/prisma.js";
import { redis } from "../../src/lib/redis.js";
import { placeBid } from "../../src/modules/bids/service.js";
import { closeAuction } from "../../src/modules/auctions/lifecycle.js";
import { AppError } from "../../src/utils/errors.js";

const RUN = !!process.env.RUN_DB_TESTS;
const tag = ulid().slice(-8);
let seq = 0;

async function makeUser(name: string) {
  return prisma.user.create({
    data: { phone: `+2519${tag.replace(/\D/g, "").padEnd(4, "0").slice(0, 4)}${String(seq++).padStart(4, "0")}`, fullName: name, passwordHash: "x", phoneVerifiedAt: new Date() },
  });
}

async function makeAuction(sellerId: bigint, over: { endsInMs?: number; reserve?: bigint } = {}) {
  const category = await prisma.category.findFirstOrThrow({ where: { slug: "phones" } });
  const product = await prisma.product.create({
    data: { sellerId, categoryId: category.id, title: `Test phone ${tag}`, description: "integration test item", condition: "USED_GOOD", location: "Addis Ababa", headline: ["128GB"], status: "APPROVED" },
  });
  const now = Date.now();
  return prisma.auction.create({
    data: {
      productId: product.id,
      status: "LIVE",
      startPrice: 100_000n,
      minIncrement: 5_000n,
      reservePrice: over.reserve,
      startsAt: new Date(now - 60_000),
      endsAt: new Date(now + (over.endsInMs ?? 60 * 60 * 1000)),
    },
  });
}

describe.runIf(RUN)("bid engine (MySQL)", () => {
  let seller: { id: bigint };
  let bidders: { id: bigint }[];

  beforeAll(async () => {
    seller = await makeUser("Seller Test");
    bidders = [];
    for (let i = 0; i < 50; i++) bidders.push(await makeUser(`Bidder Number${i}`));
  });

  afterAll(async () => {
    await prisma.$disconnect();
    redis().disconnect();
  });

  it("50 simultaneous bids at the same price: exactly one wins", async () => {
    const auction = await makeAuction(seller.id);
    const results = await Promise.allSettled(
      bidders.map((b) => placeBid({ auctionId: auction.id, bidderId: b.id, amount: 100_000n, idempotencyKey: ulid() })),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(rejected.every((r) => r.reason instanceof AppError && r.reason.code === "BID_TOO_LOW")).toBe(true);

    const after = await prisma.auction.findUniqueOrThrow({ where: { id: auction.id } });
    expect(after.bidCount).toBe(1);
    expect(after.currentPrice).toBe(100_000n);
    expect(await prisma.bid.count({ where: { auctionId: auction.id } })).toBe(1);
  });

  it("50 simultaneous bids across 10 price levels: at most one per level, state stays consistent", async () => {
    const auction = await makeAuction(seller.id);
    const amount = (i: number) => 100_000n + BigInt(i % 10) * 5_000n;
    const results = await Promise.allSettled(
      bidders.map((b, i) => placeBid({ auctionId: auction.id, bidderId: b.id, amount: amount(i), idempotencyKey: ulid() })),
    );
    const accepted = await prisma.bid.findMany({ where: { auctionId: auction.id }, orderBy: { id: "asc" } });
    const okCount = results.filter((r) => r.status === "fulfilled").length;
    expect(accepted).toHaveLength(okCount);
    expect(okCount).toBeGreaterThanOrEqual(1);

    // Each accepted bid beats the previous by at least the increment, so there is one per price level at most.
    for (let i = 1; i < accepted.length; i++) expect(accepted[i].amount - accepted[i - 1].amount >= 5_000n).toBe(true);
    expect(new Set(accepted.map((b) => b.amount)).size).toBe(accepted.length);

    const after = await prisma.auction.findUniqueOrThrow({ where: { id: auction.id } });
    expect(after.bidCount).toBe(accepted.length);
    expect(after.currentPrice).toBe(accepted[accepted.length - 1].amount);
    expect(after.currentWinnerId).toBe(accepted[accepted.length - 1].bidderId);
  });

  it("retries with the same idempotency key return the original bid", async () => {
    const auction = await makeAuction(seller.id);
    const key = ulid();
    const first = await placeBid({ auctionId: auction.id, bidderId: bidders[0].id, amount: 100_000n, idempotencyKey: key });
    const again = await Promise.all([1, 2, 3].map(() => placeBid({ auctionId: auction.id, bidderId: bidders[0].id, amount: 100_000n, idempotencyKey: key })));
    expect(first.replayed).toBe(false);
    for (const r of again) {
      expect(r.replayed).toBe(true);
      expect(r.bid.id).toBe(first.bid.id);
    }
    expect(await prisma.bid.count({ where: { auctionId: auction.id } })).toBe(1);
  });

  it("rejects the seller bidding on their own item", async () => {
    const auction = await makeAuction(seller.id);
    await expect(placeBid({ auctionId: auction.id, bidderId: seller.id, amount: 100_000n, idempotencyKey: ulid() })).rejects.toMatchObject({ code: "SELLER_CANNOT_BID" });
  });

  it("a bid in the last 2 minutes extends the auction", async () => {
    const auction = await makeAuction(seller.id, { endsInMs: 30_000 });
    await placeBid({ auctionId: auction.id, bidderId: bidders[1].id, amount: 100_000n, idempotencyKey: ulid() });
    const after = await prisma.auction.findUniqueOrThrow({ where: { id: auction.id } });
    expect(after.extensionCount).toBe(1);
    expect(after.endsAt.getTime() - auction.endsAt.getTime()).toBeGreaterThan(60_000);
  });

  it("closing picks the highest bidder, sets a payment deadline, and is idempotent", async () => {
    const auction = await makeAuction(seller.id);
    await placeBid({ auctionId: auction.id, bidderId: bidders[2].id, amount: 100_000n, idempotencyKey: ulid() });
    await placeBid({ auctionId: auction.id, bidderId: bidders[3].id, amount: 110_000n, idempotencyKey: ulid() });

    expect(await closeAuction(auction.id)).toBe("NOT_DUE");
    await prisma.auction.update({ where: { id: auction.id }, data: { endsAt: new Date(Date.now() - 1000) } });

    const outcomes = await Promise.all([closeAuction(auction.id), closeAuction(auction.id), closeAuction(auction.id)]);
    expect(outcomes.filter((o) => o === "CLOSED")).toHaveLength(1);

    const result = await prisma.auctionResult.findUniqueOrThrow({ where: { auctionId: auction.id } });
    expect(result.winnerId).toBe(bidders[3].id);
    expect(result.finalPrice).toBe(110_000n);
    expect(result.status).toBe("AWAITING_PAYMENT");
    expect(result.paymentDeadline!.getTime()).toBeGreaterThan(Date.now() + 47 * 3600_000);
    await expect(placeBid({ auctionId: auction.id, bidderId: bidders[4].id, amount: 200_000n, idempotencyKey: ulid() })).rejects.toMatchObject({ code: "AUCTION_NOT_LIVE" });
  });

  it("closing with the reserve not met is a no-sale", async () => {
    const auction = await makeAuction(seller.id, { reserve: 500_000n });
    await placeBid({ auctionId: auction.id, bidderId: bidders[5].id, amount: 100_000n, idempotencyKey: ulid() });
    await prisma.auction.update({ where: { id: auction.id }, data: { endsAt: new Date(Date.now() - 1000) } });
    expect(await closeAuction(auction.id)).toBe("NO_SALE");
    const a = await prisma.auction.findUniqueOrThrow({ where: { id: auction.id } });
    expect(a.status).toBe("NO_SALE");
  });
});
