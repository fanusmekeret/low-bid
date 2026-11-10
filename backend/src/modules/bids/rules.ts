/**
 * Pure bid rules, evaluated against the row locked with SELECT … FOR UPDATE and the database clock.
 * Kept free of I/O so they are unit-tested exhaustively.
 */
export interface LockedAuction {
  status: string;
  startPrice: bigint;
  minIncrement: bigint;
  currentPrice: bigint | null;
  currentWinnerId: bigint | null;
  endsAt: Date;
  extensionCount: number;
  depositMinor: bigint;
}

export interface BidContext {
  auction: LockedAuction;
  sellerId: bigint;
  bidderId: bigint;
  bidderStatus: string;
  amount: bigint;
  now: Date;
  depositHeld: boolean;
  antiSnipingWindowSec: number;
  maxExtensions: number;
}

export type BidRejection =
  | "AUCTION_NOT_LIVE"
  | "AUCTION_ENDED"
  | "SELLER_CANNOT_BID"
  | "ALREADY_LEADING"
  | "BIDDER_SUSPENDED"
  | "DEPOSIT_REQUIRED"
  | "BID_TOO_LOW";

export type BidDecision =
  | { ok: true; newEndsAt: Date | null }
  | { ok: false; code: BidRejection; minAcceptable?: bigint };

export function minimumNextBid(a: Pick<LockedAuction, "startPrice" | "minIncrement" | "currentPrice">): bigint {
  return a.currentPrice === null ? a.startPrice : a.currentPrice + a.minIncrement;
}

export function evaluateBid(c: BidContext): BidDecision {
  const a = c.auction;
  if (a.status !== "LIVE") return { ok: false, code: "AUCTION_NOT_LIVE" };
  if (c.now.getTime() >= a.endsAt.getTime()) return { ok: false, code: "AUCTION_ENDED" };
  if (c.bidderId === c.sellerId) return { ok: false, code: "SELLER_CANNOT_BID" };
  if (c.bidderStatus !== "ACTIVE") return { ok: false, code: "BIDDER_SUSPENDED" };
  if (a.currentWinnerId !== null && a.currentWinnerId === c.bidderId) return { ok: false, code: "ALREADY_LEADING" };
  if (a.depositMinor > 0n && !c.depositHeld) return { ok: false, code: "DEPOSIT_REQUIRED" };

  const min = minimumNextBid(a);
  if (c.amount < min) return { ok: false, code: "BID_TOO_LOW", minAcceptable: min };

  // Anti-sniping: a bid inside the window pushes the end to now + window, up to maxExtensions times.
  const windowMs = c.antiSnipingWindowSec * 1000;
  const remaining = a.endsAt.getTime() - c.now.getTime();
  const newEndsAt =
    windowMs > 0 && remaining < windowMs && a.extensionCount < c.maxExtensions
      ? new Date(c.now.getTime() + windowMs)
      : null;
  return { ok: true, newEndsAt };
}
