import { createHmac } from 'node:crypto';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { newObjectId } from '../../services/storage/keys.js';
import { AppError, conflict, forbidden, notFound } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { moneyDto } from '../../utils/money.js';
import { isRetryableTxError, jitter, lockAuction } from '../auctions/auction.lock.js';
import { bidderAlias, evaluateBid, rankBids } from '../auctions/auction.rules.js';
import { buildTxRef } from '../payments/payment.rules.js';
import { checkoutResponse, initializeWithChapa } from '../payments/payments.service.js';
import { getSetting } from '../settings/settings.service.js';

const MAX_ATTEMPTS = 4;

export const aliasSecret = () => createHmac('sha256', env.JWT_ACCESS_SECRET).update('lowbid-bidder-alias-v1').digest('hex');

const moneyDetails = (details) =>
  details && Object.fromEntries(Object.entries(details).map(([k, v]) => [k, typeof v === 'bigint' ? moneyDto(v) : v]));

/** Account-level reasons a user cannot bid at all. */
function bidderBlock(user, rules) {
  if (!user) return { code: 'AUTH_USER_NOT_FOUND', message: 'Account not found' };
  if (user.status !== 'ACTIVE') return { code: 'ACCOUNT_SUSPENDED', message: 'Your account cannot bid right now. Contact support' };
  if (!user.phoneVerifiedAt) return { code: 'PHONE_NOT_VERIFIED', message: 'Verify your phone number first' };
  if (user.paymentStrikes >= rules.maxPaymentStrikes) {
    return { code: 'BIDDING_BLOCKED', message: 'Bidding is blocked after unpaid wins. Contact support' };
  }
  return null;
}

const presentOwnBid = (b) => ({
  id: b.id.toString(),
  amount: moneyDto(b.amount),
  status: b.status,
  createdAt: b.createdAt,
  activatedAt: b.activatedAt,
});

/** Same request sent twice (flaky network, double tap): return the first bid and its checkout. */
async function replay(auctionId, userId, idempotencyKey) {
  const existing = await prisma.bid.findUnique({
    where: { auctionId_idempotencyKey: { auctionId: BigInt(auctionId), idempotencyKey } },
    include: { payment: true },
  });
  if (!existing) return null;
  if (existing.bidderId !== BigInt(userId)) throw conflict('IDEMPOTENCY_KEY_REUSED', 'Generate a new idempotency key for each bid');
  return { replay: true, bid: presentOwnBid(existing), payment: existing.payment ? checkoutResponse(existing.payment, true) : null };
}

/**
 * Places one bid: records the secret amount (awaiting its fee) and starts the bid-fee
 * checkout with Chapa. The bid takes part only once the fee is verified (see settle() in
 * payments.service). The client sends only the amount and an idempotency key.
 *
 * @param {{ auctionId: bigint, userId: bigint, amount: bigint, idempotencyKey: string, ip?: string }} input
 */
export async function placeBid({ auctionId, userId, amount, idempotencyKey, ip }) {
  const earlier = await replay(auctionId, userId, idempotencyKey);
  if (earlier) return earlier;

  const [rules, luba, chapaCfg, user] = await Promise.all([
    getSetting('auction.rules'),
    getSetting('auction.lowestUniqueBid'),
    getSetting('payment.chapa'),
    prisma.user.findUnique({ where: { id: BigInt(userId) } }),
  ]);
  const block = bidderBlock(user, rules);

  let created;
  for (let attempt = 1; ; attempt += 1) {
    try {
      created = await prisma.$transaction(async (tx) => {
        const s = await lockAuction(tx, auctionId);
        // Bids the person has that still count or may still count (fee being paid).
        const mine = await tx.bid.findMany({
          where: { auctionId: s.id, bidderId: BigInt(userId), status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } },
          select: { amount: true },
        });
        const decision = evaluateBid(s, { bidderId: BigInt(userId), amount, myOpenAmounts: mine.map((b) => b.amount), bidderBlock: block });
        if (!decision.ok) throw new AppError(decision.status, decision.code, decision.message, moneyDetails(decision.details));

        // The checkout stays open until the close waits no longer for late fees.
        const lastUseful = s.endsAt.getTime() + luba.settleWindowMinutes * 60_000;
        const payment = await tx.payment.create({
          data: {
            txRef: buildTxRef('BID_FEE', s.id, newObjectId()),
            purpose: 'BID_FEE',
            auctionId: s.id,
            userId: BigInt(userId),
            amount: s.bidFee,
            currency: 'ETB',
            status: 'INITIATED',
            expiresAt: new Date(Math.min(s.now.getTime() + chapaCfg.checkoutTimeoutMinutes * 60_000, lastUseful)),
          },
        });
        const bid = await tx.bid.create({
          data: {
            auctionId: s.id,
            bidderId: BigInt(userId),
            amount,
            status: 'PENDING_PAYMENT',
            paymentId: payment.id,
            idempotencyKey,
            ip: ip ?? null,
            createdAt: s.now,
          },
        });
        return { bid, payment };
      }, { maxWait: 5_000, timeout: 10_000 });
      break;
    } catch (err) {
      // Lost a race on the same idempotency key: the other request's bid stands.
      if (err?.code === 'P2002') {
        const r = await replay(auctionId, userId, idempotencyKey);
        if (r) return r;
      }
      if (isRetryableTxError(err) && attempt < MAX_ATTEMPTS) {
        await jitter(attempt);
        continue;
      }
      throw err;
    }
  }

  let payment;
  try {
    payment = await initializeWithChapa(created.payment, user, { auctionId, purpose: 'BID_FEE' });
  } catch (err) {
    // No checkout, so the bid can never be paid: release the amount for another try.
    await prisma.bid.update({ where: { id: created.bid.id }, data: { status: 'VOID' } }).catch((e) => logger.error({ err: e }, 'could not void bid'));
    throw err;
  }
  return { replay: false, bid: presentOwnBid(created.bid), payment: checkoutResponse(payment, false) };
}

/** The viewer's own bids on one auction (they know their amounts; nobody else does until the end). */
export async function myBidsOnAuction(auctionId, userId) {
  const rows = await prisma.bid.findMany({
    where: { auctionId: BigInt(auctionId), bidderId: BigInt(userId), status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } },
    orderBy: { amount: 'asc' },
    include: { payment: { select: { txRef: true, status: true, checkoutUrl: true } } },
  });
  return rows.map((b) => ({
    ...presentOwnBid(b),
    txRef: b.payment?.txRef ?? null,
    checkoutUrl: b.status === 'PENDING_PAYMENT' && ['INITIATED', 'PENDING'].includes(b.payment?.status) ? b.payment.checkoutUrl : null,
  }));
}

/**
 * The full result, revealed once the auction has closed: every paid bid with its amount,
 * whether it was unique, and its place. While bidding is open this is refused, so nobody
 * can learn which amounts are taken.
 */
export async function bidHistory(auctionId, { cursor, limit, viewerId }) {
  const auction = await prisma.auction.findUnique({ where: { id: BigInt(auctionId) }, select: { id: true, status: true, result: { select: { winningBidId: true } } } });
  if (!auction || !['SCHEDULED', 'LIVE', 'CLOSED'].includes(auction.status)) throw notFound('AUCTION_NOT_FOUND', 'Auction not found');
  if (auction.status !== 'CLOSED') throw forbidden('BIDS_SECRET', 'Bids are revealed when the auction ends');

  const bids = await prisma.bid.findMany({
    where: { auctionId: auction.id, status: 'ACTIVE' },
    include: { bidder: { select: { firstName: true } } },
  });
  const ranked = rankBids(bids);
  const start = cursor ? Number(cursor) : 0;
  const page = ranked.slice(start, start + limit);
  const secret = aliasSecret();
  return {
    data: page.map((b, i) => ({
      id: b.id.toString(),
      rank: start + i + 1,
      amount: moneyDto(b.amount),
      unique: b.unique,
      isWinning: auction.result?.winningBidId === b.id,
      bidderAlias: bidderAlias(b.bidder.firstName, auction.id, b.bidderId, secret),
      isYou: viewerId !== undefined && viewerId !== null && b.bidderId === BigInt(viewerId),
      createdAt: b.activatedAt,
    })),
    meta: { nextCursor: start + limit < ranked.length ? String(start + limit) : null, total: ranked.length },
  };
}
