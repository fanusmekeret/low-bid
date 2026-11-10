import { createHmac } from 'node:crypto';

// Pure rules for LOW BID's lowest-unique-bid auctions. No database, no clock: every input,
// including "now", is passed in, so the same decision is reached on every server.
//
// How an auction works
//   • Each bid is an amount in birr (e.g. 37.45) plus a bid fee paid through Chapa.
//   • A bid counts once its fee is verified (status ACTIVE). Amounts stay secret until the end.
//   • At the close, the lowest amount that exactly one bid has wins ("lowest unique bid").
//   • If no amount is unique, the lowest amount wins, and among bids on it the one whose fee
//     was confirmed first.
//   • The winner pays their bid amount. The seller is paid their agreed price (less commission);
//     bid fees fund the difference.

const MINUTE = 60_000;
export const MIN_START_LEAD_MINUTES = 10;
export const MAX_START_AHEAD_DAYS = 60;
export const MIN_SELLER_PRICE_MINOR = 100_00n; // 100 ETB
export const MAX_PRICE_MINOR = 10_000_000_000_00n; // 10 billion ETB
export const MIN_BID_FEE_MINOR = 100n; // 1 ETB

/** Statuses buyers can see. */
export const PUBLIC_STATUSES = Object.freeze(['SCHEDULED', 'LIVE', 'CLOSED']);

/**
 * Checks a seller's new auction. Returns a list of { path, message }; empty means valid.
 * @param {{ sellerPrice: bigint, marketValue: bigint|null, startsAt: Date, durationMinutes: number, now: Date,
 *           rules: { minDurationHours: number, maxDurationDays: number } }} d
 */
export function validateAuctionDraft(d) {
  const errors = [];
  const add = (path, message) => errors.push({ path, message });

  if (d.sellerPrice < MIN_SELLER_PRICE_MINOR) add('sellerPrice', 'Your price must be at least 100 ETB');
  if (d.sellerPrice > MAX_PRICE_MINOR) add('sellerPrice', 'Your price is too high');
  if (d.marketValue !== null && d.marketValue !== undefined && d.marketValue < d.sellerPrice) add('marketValue', 'The retail value cannot be below your price');

  const lead = d.startsAt.getTime() - d.now.getTime();
  if (lead < MIN_START_LEAD_MINUTES * MINUTE) add('startsAt', `Start at least ${MIN_START_LEAD_MINUTES} minutes from now, to leave time for approval`);
  if (lead > MAX_START_AHEAD_DAYS * 24 * 60 * MINUTE) add('startsAt', `Start within ${MAX_START_AHEAD_DAYS} days`);

  const minMinutes = d.rules.minDurationHours * 60;
  const maxMinutes = d.rules.maxDurationDays * 24 * 60;
  if (d.durationMinutes < minMinutes) add('durationMinutes', `Auctions last at least ${d.rules.minDurationHours} hour(s)`);
  if (d.durationMinutes > maxMinutes) add('durationMinutes', `Auctions last at most ${d.rules.maxDurationDays} days`);
  return errors;
}

/**
 * Bidding terms an admin sets (or the defaults). Returns a list of { path, message }.
 * @param {{ bidFee: bigint, minBid: bigint, maxBid: bigint, bidStep: bigint, minPaidBids: number, maxBidsPerUser: number }} t
 */
export function validateBiddingTerms(t) {
  const errors = [];
  const add = (path, message) => errors.push({ path, message });
  if (t.bidFee < MIN_BID_FEE_MINOR) add('bidFee', 'The bid fee must be at least 1 ETB');
  if (t.bidStep < 1n) add('bidStep', 'The bid step must be at least 0.01 ETB');
  if (t.minBid < 1n) add('minBid', 'The lowest bid must be at least 0.01 ETB');
  if (t.maxBid <= t.minBid) add('maxBid', 'The highest bid must be above the lowest bid');
  if (t.minBid % t.bidStep !== 0n) add('minBid', 'The lowest bid must be a multiple of the bid step');
  if (!Number.isInteger(t.minPaidBids) || t.minPaidBids < 0) add('minPaidBids', 'Minimum paid bids cannot be negative');
  if (!Number.isInteger(t.maxBidsPerUser) || t.maxBidsPerUser < 1) add('maxBidsPerUser', 'Allow at least one bid per person');
  return errors;
}

/** Defaults for a new auction: the category's fee (or the platform's), bids from 0.01 ETB up to the seller's price. */
export function defaultBiddingTerms({ sellerPrice, categoryBidFee, settings }) {
  const fee = categoryBidFee > 0n ? categoryBidFee : BigInt(settings.defaultBidFeeMinor);
  return {
    bidFee: fee,
    minBid: BigInt(settings.minBidMinor),
    maxBid: sellerPrice,
    bidStep: BigInt(settings.bidStepMinor),
    minPaidBids: 0,
    maxBidsPerUser: settings.maxBidsPerUser,
  };
}

/**
 * When an admin approves late, keep the auction's full length by moving it forward.
 * @returns {{ startsAt: Date, endsAt: Date, startsNow: boolean }}
 */
export function scheduleOnApproval({ startsAt, endsAt, now }) {
  if (startsAt > now) return { startsAt, endsAt, startsNow: false };
  const duration = endsAt.getTime() - startsAt.getTime();
  return { startsAt: now, endsAt: new Date(now.getTime() + duration), startsNow: true };
}

/**
 * Decides whether a new bid may be placed (its fee checkout can start).
 *
 * @param {object} s locked auction state
 * @param {string} s.status
 * @param {Date} s.startsAt
 * @param {Date} s.endsAt
 * @param {Date} s.now database clock
 * @param {bigint} s.sellerUserId
 * @param {bigint} s.minBid
 * @param {bigint} s.maxBid
 * @param {bigint} s.bidStep
 * @param {number} s.maxBidsPerUser
 * @param {object} b the bid
 * @param {bigint} b.bidderId
 * @param {bigint} b.amount santim
 * @param {bigint[]} b.myOpenAmounts amounts this bidder already has ACTIVE or awaiting payment
 * @param {null|{ code: string, message: string }} b.bidderBlock account-level reason this bidder cannot bid
 * @returns {{ ok: false, code: string, message: string, status: number, details?: object } | { ok: true, becameLive: boolean }}
 */
export function evaluateBid(s, b) {
  const fail = (status, code, message, details) => ({ ok: false, status, code, message, details });

  if (s.status === 'CLOSED' || s.status === 'CANCELLED') return fail(409, 'AUCTION_ENDED', 'This auction has ended');
  if (s.status !== 'LIVE' && s.status !== 'SCHEDULED') return fail(409, 'AUCTION_NOT_OPEN', 'This auction is not open for bidding');
  if (s.now >= s.endsAt) return fail(409, 'AUCTION_ENDED', 'This auction has ended');
  if (s.status === 'SCHEDULED' && s.now < s.startsAt) {
    return fail(409, 'AUCTION_NOT_STARTED', 'Bidding has not started yet', { startsAt: s.startsAt });
  }
  if (b.bidderId === s.sellerUserId) return fail(403, 'SELLER_CANNOT_BID', 'You cannot bid on your own item');
  if (b.bidderBlock) return fail(403, b.bidderBlock.code, b.bidderBlock.message);

  if (b.amount < s.minBid || b.amount > s.maxBid) {
    return fail(400, 'BID_OUT_OF_RANGE', 'Bids must be within the allowed range', { minBid: s.minBid, maxBid: s.maxBid });
  }
  if (b.amount % s.bidStep !== 0n) return fail(400, 'BID_STEP_INVALID', 'Use an amount in the allowed steps', { bidStep: s.bidStep });
  if (b.myOpenAmounts.some((a) => a === b.amount)) return fail(409, 'DUPLICATE_BID_AMOUNT', 'You already bid this amount. Choose a different amount');
  if (b.myOpenAmounts.length >= s.maxBidsPerUser) {
    return fail(409, 'BID_LIMIT_REACHED', `You can place at most ${s.maxBidsPerUser} bids on this auction`, { maxBidsPerUser: s.maxBidsPerUser });
  }
  return { ok: true, becameLive: s.status === 'SCHEDULED' };
}

/**
 * Orders paid bids for the close (and for second-chance offers):
 *   1. bids whose amount is unique, lowest amount first;
 *   2. then the other bids, lowest amount first, earliest confirmed fee first within an amount.
 * Uniqueness counts every paid bid, including bids from accounts that are later skipped.
 *
 * @template {{ id: bigint, bidderId: bigint, amount: bigint, activatedAt: Date }} B
 * @param {B[]} bids ACTIVE bids
 * @returns {(B & { unique: boolean })[]}
 */
export function rankBids(bids) {
  const counts = new Map();
  for (const b of bids) counts.set(b.amount, (counts.get(b.amount) ?? 0) + 1);
  const cmp = (x, y) => {
    if (x.amount !== y.amount) return x.amount < y.amount ? -1 : 1;
    const t = x.activatedAt.getTime() - y.activatedAt.getTime();
    if (t !== 0) return t;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  };
  const withFlag = bids.map((b) => ({ ...b, unique: counts.get(b.amount) === 1 }));
  return [...withFlag.filter((b) => b.unique).sort(cmp), ...withFlag.filter((b) => !b.unique).sort(cmp)];
}

/**
 * Picks the winner from ranked bids, skipping bidders who are not eligible (suspended,
 * banned) or already excluded (they let an earlier offer expire).
 * @param {ReturnType<typeof rankBids>} ranked
 * @param {{ isEligible: (bidderId: bigint) => boolean, excluded?: Set<bigint> }} opts
 */
export function pickWinner(ranked, { isEligible, excluded = new Set() }) {
  for (const b of ranked) if (!excluded.has(b.bidderId) && isEligible(b.bidderId)) return b;
  return null;
}

/**
 * @param {{ winningBid: object|null, paidBids: number, minPaidBids: number }} x
 * @returns {{ outcome: 'SOLD'|'NO_BIDS'|'NOT_ENOUGH_BIDS', finalPrice: bigint|null }}
 */
export function closeOutcome({ winningBid, paidBids, minPaidBids }) {
  if (paidBids === 0 || !winningBid) return { outcome: 'NO_BIDS', finalPrice: null };
  if (paidBids < minPaidBids) return { outcome: 'NOT_ENOUGH_BIDS', finalPrice: null };
  return { outcome: 'SOLD', finalPrice: winningBid.amount };
}

/**
 * Public name for a bidder: "A***e · 7F3C". The tag is stable within one auction but differs
 * between auctions, so bidders cannot be tracked across auctions.
 */
export function bidderAlias(firstName, auctionId, userId, secret) {
  const name = (firstName || 'Bidder').trim();
  const chars = [...name];
  const masked = chars.length <= 2 ? `${chars[0]}*` : `${chars[0]}***${chars.at(-1)}`;
  const tag = createHmac('sha256', secret).update(`${auctionId}:${userId}`).digest('hex').slice(0, 4).toUpperCase();
  return `${masked} · ${tag}`;
}

/**
 * What a user sees about their position. While bidding is open nobody learns where they
 * stand (bids are secret), so it is just BIDDING.
 */
export function myAuctionStatus({ status, result }, userId) {
  if (status === 'CANCELLED') return 'CANCELLED';
  if (status === 'CLOSED') {
    if (result?.outcome === 'SOLD' && result.winnerId === userId) return 'WON';
    return 'LOST';
  }
  return 'BIDDING';
}
