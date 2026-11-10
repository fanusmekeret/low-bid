import { describe, expect, it } from "vitest";
import { evaluateBid, minimumNextBid, type BidContext } from "../src/modules/bids/rules.js";

const now = new Date("2026-11-10T10:00:00.000Z");
const base = (over: Partial<BidContext> = {}, auction: Partial<BidContext["auction"]> = {}): BidContext => ({
  auction: {
    status: "LIVE",
    startPrice: 100_000n,
    minIncrement: 5_000n,
    currentPrice: null,
    currentWinnerId: null,
    endsAt: new Date(now.getTime() + 60 * 60 * 1000),
    extensionCount: 0,
    depositMinor: 0n,
    ...auction,
  },
  sellerId: 1n,
  bidderId: 2n,
  bidderStatus: "ACTIVE",
  amount: 100_000n,
  now,
  depositHeld: false,
  antiSnipingWindowSec: 120,
  maxExtensions: 3,
  ...over,
});

describe("minimumNextBid", () => {
  it("is the start price for the first bid", () => {
    expect(minimumNextBid({ startPrice: 100n, minIncrement: 10n, currentPrice: null })).toBe(100n);
  });
  it("is current price plus increment afterwards", () => {
    expect(minimumNextBid({ startPrice: 100n, minIncrement: 10n, currentPrice: 150n })).toBe(160n);
  });
});

describe("evaluateBid", () => {
  it("accepts a first bid at the start price", () => {
    expect(evaluateBid(base())).toEqual({ ok: true, newEndsAt: null });
  });

  it("rejects a first bid below the start price and reports the minimum", () => {
    expect(evaluateBid(base({ amount: 99_999n }))).toEqual({ ok: false, code: "BID_TOO_LOW", minAcceptable: 100_000n });
  });

  it("requires the minimum increment over the current price", () => {
    const a = { currentPrice: 120_000n, currentWinnerId: 3n };
    expect(evaluateBid(base({ amount: 124_999n }, a))).toMatchObject({ ok: false, code: "BID_TOO_LOW", minAcceptable: 125_000n });
    expect(evaluateBid(base({ amount: 125_000n }, a))).toMatchObject({ ok: true });
  });

  it("rejects bids when not live or already ended (server clock)", () => {
    expect(evaluateBid(base({}, { status: "SCHEDULED" }))).toMatchObject({ code: "AUCTION_NOT_LIVE" });
    expect(evaluateBid(base({}, { endsAt: now }))).toMatchObject({ code: "AUCTION_ENDED" });
  });

  it("blocks the seller and the current leader", () => {
    expect(evaluateBid(base({ bidderId: 1n }))).toMatchObject({ code: "SELLER_CANNOT_BID" });
    expect(evaluateBid(base({ amount: 200_000n }, { currentPrice: 150_000n, currentWinnerId: 2n }))).toMatchObject({ code: "ALREADY_LEADING" });
  });

  it("blocks suspended bidders and missing deposits", () => {
    expect(evaluateBid(base({ bidderStatus: "SUSPENDED" }))).toMatchObject({ code: "BIDDER_SUSPENDED" });
    expect(evaluateBid(base({}, { depositMinor: 5_000n }))).toMatchObject({ code: "DEPOSIT_REQUIRED" });
    expect(evaluateBid(base({ depositHeld: true }, { depositMinor: 5_000n }))).toMatchObject({ ok: true });
  });

  it("extends the end to now + window for a bid inside the anti-sniping window", () => {
    const d = evaluateBid(base({}, { endsAt: new Date(now.getTime() + 30_000) }));
    expect(d).toEqual({ ok: true, newEndsAt: new Date(now.getTime() + 120_000) });
  });

  it("does not extend outside the window or after the max extension count", () => {
    expect(evaluateBid(base({}, { endsAt: new Date(now.getTime() + 121_000) }))).toEqual({ ok: true, newEndsAt: null });
    expect(evaluateBid(base({}, { endsAt: new Date(now.getTime() + 30_000), extensionCount: 3 }))).toEqual({ ok: true, newEndsAt: null });
  });
});
