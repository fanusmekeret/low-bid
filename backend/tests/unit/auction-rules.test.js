import assert from 'node:assert/strict';
import { describe, it } from 'bun:test';
import {
  bidderAlias, closeOutcome, defaultBiddingTerms, evaluateBid, myAuctionStatus, pickWinner, rankBids,
  scheduleOnApproval, validateAuctionDraft, validateBiddingTerms,
} from '../../src/modules/auctions/auction.rules.js';

const ETB = (n) => BigInt(Math.round(n * 100));
const T0 = new Date('2026-11-08T12:00:00.000Z');
const at = (ms) => new Date(T0.getTime() + ms);

const live = (over = {}) => ({
  status: 'LIVE', startsAt: at(-3_600_000), endsAt: at(3_600_000), now: T0, sellerUserId: 1n,
  minBid: 1n, maxBid: ETB(145_000), bidStep: 1n, maxBidsPerUser: 50, ...over,
});
const bid = (over = {}) => ({ bidderId: 9n, amount: ETB(37.45), myOpenAmounts: [], bidderBlock: null, ...over });

describe('evaluateBid: accepting', () => {
  it('accepts a bid within the range', () => {
    const r = evaluateBid(live(), bid());
    assert.equal(r.ok, true);
    assert.equal(r.becameLive, false);
  });
  it('accepts the smallest and largest allowed amounts', () => {
    assert.equal(evaluateBid(live(), bid({ amount: 1n })).ok, true);
    assert.equal(evaluateBid(live(), bid({ amount: ETB(145_000) })).ok, true);
  });
  it('opens a scheduled auction whose start time has passed', () => {
    const r = evaluateBid(live({ status: 'SCHEDULED', startsAt: at(-1) }), bid());
    assert.equal(r.ok, true);
    assert.equal(r.becameLive, true);
  });
  it('lets one person bid several different amounts', () => {
    assert.equal(evaluateBid(live(), bid({ myOpenAmounts: [ETB(1), ETB(2)] })).ok, true);
  });
});

describe('evaluateBid: rejecting', () => {
  const code = (s, b) => evaluateBid(live(s), bid(b)).code;
  it('rejects closed, cancelled and finished auctions', () => {
    assert.equal(code({ status: 'CLOSED' }), 'AUCTION_ENDED');
    assert.equal(code({ status: 'CANCELLED' }), 'AUCTION_ENDED');
    assert.equal(code({ endsAt: T0 }), 'AUCTION_ENDED');
    assert.equal(code({ status: 'PENDING_APPROVAL' }), 'AUCTION_NOT_OPEN');
  });
  it('one millisecond before the end still counts', () => assert.equal(evaluateBid(live({ endsAt: at(1) }), bid()).ok, true));
  it('rejects bids before the start', () => assert.equal(code({ status: 'SCHEDULED', startsAt: at(1) }), 'AUCTION_NOT_STARTED'));
  it('stops sellers bidding on their own items', () => assert.equal(code({}, { bidderId: 1n }), 'SELLER_CANNOT_BID'));
  it('passes on account blocks', () => assert.equal(code({}, { bidderBlock: { code: 'PHONE_NOT_VERIFIED', message: 'x' } }), 'PHONE_NOT_VERIFIED'));
  it('enforces the range', () => {
    assert.equal(code({ minBid: ETB(1) }, { amount: ETB(0.99) }), 'BID_OUT_OF_RANGE');
    assert.equal(code({}, { amount: ETB(145_000) + 1n }), 'BID_OUT_OF_RANGE');
    assert.equal(code({}, { amount: 0n }), 'BID_OUT_OF_RANGE');
  });
  it('enforces the step', () => {
    assert.equal(code({ bidStep: 100n }, { amount: ETB(37.45) }), 'BID_STEP_INVALID');
    assert.equal(evaluateBid(live({ bidStep: 100n }), bid({ amount: ETB(37) })).ok, true);
  });
  it('rejects the same amount twice from one person', () => {
    assert.equal(code({}, { myOpenAmounts: [ETB(37.45)] }), 'DUPLICATE_BID_AMOUNT');
  });
  it('limits bids per person', () => {
    const r = evaluateBid(live({ maxBidsPerUser: 2 }), bid({ myOpenAmounts: [ETB(1), ETB(2)] }));
    assert.equal(r.code, 'BID_LIMIT_REACHED');
    assert.equal(r.details.maxBidsPerUser, 2);
  });
});

describe('rankBids and pickWinner: lowest unique bid wins', () => {
  const b = (id, bidderId, etb, secs) => ({ id, bidderId, amount: ETB(etb), activatedAt: at(secs * 1000) });

  it('picks the lowest amount that only one person bid', () => {
    const bids = [b(1n, 10n, 1, 1), b(2n, 11n, 1, 2), b(3n, 12n, 2, 3), b(4n, 13n, 3, 4), b(5n, 14n, 2.5, 5)];
    const ranked = rankBids(bids);
    // 1 ETB is shared, so 2 ETB (unique) wins, then 2.5, then 3; the shared 1s come last.
    assert.deepEqual(ranked.map((x) => x.id), [3n, 5n, 4n, 1n, 2n]);
    assert.deepEqual(ranked.map((x) => x.unique), [true, true, true, false, false]);
    assert.equal(pickWinner(ranked, { isEligible: () => true }).id, 3n);
  });

  it('when no amount is unique, the lowest amount wins, earliest confirmed fee first', () => {
    const bids = [b(1n, 10n, 5, 30), b(2n, 11n, 5, 10), b(3n, 12n, 4, 50), b(4n, 13n, 4, 20)];
    const ranked = rankBids(bids);
    assert.ok(ranked.every((x) => !x.unique));
    assert.equal(pickWinner(ranked, { isEligible: () => true }).id, 4n, '4 ETB is lowest; bid 4 was confirmed before bid 3');
  });

  it('breaks an exact time tie by bid id', () => {
    const ranked = rankBids([b(9n, 10n, 1, 5), b(8n, 11n, 1, 5)]);
    assert.equal(ranked[0].id, 8n);
  });

  it('counts uniqueness across everyone, then skips ineligible winners', () => {
    const bids = [b(1n, 10n, 1, 1), b(2n, 11n, 2, 2), b(3n, 12n, 3, 3)];
    const ranked = rankBids(bids);
    assert.equal(pickWinner(ranked, { isEligible: (id) => id !== 10n }).id, 2n);
    assert.equal(pickWinner(ranked, { isEligible: () => true, excluded: new Set([10n, 11n]) }).id, 3n, 'second chance goes down the ranking');
    assert.equal(pickWinner(ranked, { isEligible: () => false }), null);
  });

  it('one person with several unique amounts can win with their lowest', () => {
    const ranked = rankBids([b(1n, 10n, 7, 1), b(2n, 10n, 3, 2), b(3n, 11n, 3, 3), b(4n, 12n, 5, 4)]);
    assert.equal(pickWinner(ranked, { isEligible: () => true }).id, 4n, '3 ETB is shared; 5 ETB is the lowest unique');
  });
});

describe('closeOutcome', () => {
  const winning = { amount: ETB(2) };
  it('no paid bids', () => assert.deepEqual(closeOutcome({ winningBid: null, paidBids: 0, minPaidBids: 0 }), { outcome: 'NO_BIDS', finalPrice: null }));
  it('not enough paid bids', () => assert.deepEqual(closeOutcome({ winningBid: winning, paidBids: 9, minPaidBids: 10 }), { outcome: 'NOT_ENOUGH_BIDS', finalPrice: null }));
  it('sold at the winning amount', () => assert.deepEqual(closeOutcome({ winningBid: winning, paidBids: 10, minPaidBids: 10 }), { outcome: 'SOLD', finalPrice: ETB(2) }));
});

describe('auction drafts and bidding terms', () => {
  const rules = { minDurationHours: 1, maxDurationDays: 30 };
  const draft = (over = {}) => ({ sellerPrice: ETB(10_000), marketValue: null, startsAt: at(3_600_000), durationMinutes: 24 * 60, now: T0, rules, ...over });
  const paths = (over) => validateAuctionDraft(draft(over)).map((e) => e.path);

  it('accepts a normal auction', () => assert.deepEqual(paths(), []));
  it('needs time for approval before starting', () => assert.deepEqual(paths({ startsAt: at(5 * 60_000) }), ['startsAt']));
  it('enforces duration limits', () => {
    assert.deepEqual(paths({ durationMinutes: 30 }), ['durationMinutes']);
    assert.deepEqual(paths({ durationMinutes: 31 * 24 * 60 }), ['durationMinutes']);
  });
  it('needs a sensible seller price and retail value', () => {
    assert.deepEqual(paths({ sellerPrice: ETB(99) }), ['sellerPrice']);
    assert.deepEqual(paths({ marketValue: ETB(9_999) }), ['marketValue']);
    assert.deepEqual(paths({ marketValue: ETB(12_000) }), []);
  });

  const settings = { defaultBidFeeMinor: '1000', minBidMinor: '1', bidStepMinor: '1', maxBidsPerUser: 50 };
  it('defaults: platform fee, bids from 0.01 ETB up to the seller price', () => {
    const t = defaultBiddingTerms({ sellerPrice: ETB(145_000), categoryBidFee: 0n, settings });
    assert.deepEqual(t, { bidFee: ETB(10), minBid: 1n, maxBid: ETB(145_000), bidStep: 1n, minPaidBids: 0, maxBidsPerUser: 50 });
    assert.deepEqual(validateBiddingTerms(t), []);
  });
  it('uses the category fee when set (e.g. 50 ETB for vehicles)', () => {
    assert.equal(defaultBiddingTerms({ sellerPrice: ETB(1_000_000), categoryBidFee: ETB(50), settings }).bidFee, ETB(50));
  });
  it('validates admin changes to the terms', () => {
    const ok = { bidFee: ETB(10), minBid: 1n, maxBid: ETB(100), bidStep: 1n, minPaidBids: 0, maxBidsPerUser: 5 };
    const p = (over) => validateBiddingTerms({ ...ok, ...over }).map((e) => e.path);
    assert.deepEqual(p({}), []);
    assert.deepEqual(p({ bidFee: 99n }), ['bidFee']);
    assert.deepEqual(p({ maxBid: 1n }), ['maxBid']);
    assert.deepEqual(p({ bidStep: 100n, minBid: 150n }), ['minBid']);
    assert.deepEqual(p({ maxBidsPerUser: 0 }), ['maxBidsPerUser']);
  });
});

describe('scheduling helpers', () => {
  it('moves a late-approved auction forward and keeps its length', () => {
    const r = scheduleOnApproval({ startsAt: at(-600_000), endsAt: at(3_000_000), now: T0 });
    assert.equal(r.startsNow, true);
    assert.deepEqual(r.startsAt, T0);
    assert.deepEqual(r.endsAt, at(3_600_000));
  });
  it('leaves a future auction alone', () => assert.equal(scheduleOnApproval({ startsAt: at(1), endsAt: at(2), now: T0 }).startsNow, false));
});

describe('bidder aliases and my status', () => {
  const secret = 's'.repeat(64);
  it('masks names with a per-auction tag', () => {
    const a1 = bidderAlias('Abebe', 1n, 5n, secret);
    assert.match(a1, /^A\*\*\*e · [0-9A-F]{4}$/);
    assert.equal(bidderAlias('Abebe', 1n, 5n, secret), a1, 'stable inside an auction');
    assert.notEqual(bidderAlias('Abebe', 2n, 5n, secret), a1, 'differs across auctions');
    assert.match(bidderAlias('ሰላም', 1n, 6n, secret), /^ሰ\*\*\*ም · /);
    assert.match(bidderAlias('Al', 1n, 7n, secret), /^A\* · /);
  });
  it('reveals nothing while bidding is open', () => {
    assert.equal(myAuctionStatus({ status: 'LIVE', currentWinnerId: 5n }, 5n), 'BIDDING');
    assert.equal(myAuctionStatus({ status: 'CLOSED', result: { outcome: 'SOLD', winnerId: 5n } }, 5n), 'WON');
    assert.equal(myAuctionStatus({ status: 'CLOSED', result: { outcome: 'NOT_ENOUGH_BIDS', winnerId: null } }, 5n), 'LOST');
    assert.equal(myAuctionStatus({ status: 'CANCELLED' }, 5n), 'CANCELLED');
  });
});
