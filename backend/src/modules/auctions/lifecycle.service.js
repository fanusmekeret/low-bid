import { prisma } from '../../config/prisma.js';
import { ENDING_SOON_MINUTES, scheduleAuctionClose, scheduleAuctionJobs } from '../../jobs/queue.js';
import { emitToAuction, emitToUser } from '../../sockets/realtime.js';
import { conflict } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { applyBasisPoints, formatEtb, moneyDto } from '../../utils/money.js';
import { recordAudit } from '../audit/audit.service.js';
import { aliasSecret } from '../bids/bids.service.js';
import { notify, notifyMany } from '../notifications/notifications.service.js';
import { verifyAndSettle } from '../payments/payments.service.js';
import { afterAuctionCancelled, afterAuctionClosed } from '../payments/results.service.js';
import { getSetting } from '../settings/settings.service.js';
import { isRetryableTxError, jitter, lockAuction } from './auction.lock.js';
import { bidderAlias, closeOutcome, pickWinner, rankBids } from './auction.rules.js';

async function withRetry(fn) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(fn, { maxWait: 5_000, timeout: 20_000 });
    } catch (err) {
      if (isRetryableTxError(err) && attempt < 4) { await jitter(attempt); continue; }
      throw err;
    }
  }
}

// ───────────────────────────── Start ─────────────────────────────

/** SCHEDULED → LIVE at the start time. Idempotent. */
export async function startAuction(auctionId) {
  const r = await withRetry(async (tx) => {
    const s = await lockAuction(tx, auctionId);
    if (s.status !== 'SCHEDULED') return { result: 'skipped', status: s.status };
    if (s.now >= s.endsAt) return { result: 'past-end' };
    if (s.now < s.startsAt) return { result: 'not-due', rescheduleAt: s.startsAt };
    const a = await tx.auction.update({ where: { id: s.id }, data: { status: 'LIVE' } });
    return { result: 'started', auction: a };
  });
  if (r.result === 'past-end') return closeAuction(auctionId);
  if (r.result === 'started') emitToAuction(auctionId, 'auction:started', { auctionId, endsAt: r.auction.endsAt });
  return r;
}

// ───────────────────────────── Close ─────────────────────────────

/**
 * Bid fees still being confirmed when bidding ends get a short window (settleWindowMinutes):
 * check them with Chapa now, and if any are still unconfirmed, close a little later.
 * @returns {Promise<Date|null>} when to try again, or null to close now
 */
async function settleLateFees(auctionId, endsAt, now) {
  const luba = await getSetting('auction.lowestUniqueBid');
  const recent = new Date(Date.now() - 15_000);
  const pending = await prisma.bid.findMany({
    where: { auctionId: BigInt(auctionId), status: 'PENDING_PAYMENT', payment: { status: { in: ['INITIATED', 'PENDING'] }, OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lte: recent } }] } },
    select: { payment: { select: { txRef: true } } },
    take: 500,
  });
  for (const b of pending) await verifyAndSettle(b.payment.txRef, { source: 'close' }).catch((err) => logger.warn({ err, auctionId: String(auctionId) }, 'late fee check failed'));
  const windowEnd = new Date(endsAt.getTime() + luba.settleWindowMinutes * 60_000);
  if (now >= windowEnd) return null;
  const left = await prisma.bid.count({ where: { auctionId: BigInt(auctionId), status: 'PENDING_PAYMENT', payment: { status: { in: ['INITIATED', 'PENDING'] } } } });
  return left > 0 ? new Date(Math.min(windowEnd.getTime(), now.getTime() + 30_000)) : null;
}

/**
 * Closes an auction whose end time has passed (by the database clock) and picks the winner:
 * the lowest unique paid bid, or, if no amount is unique, the lowest amount whose fee was
 * confirmed first. Idempotent: a second call, or a call before the end, changes nothing.
 */
export async function closeAuction(auctionId) {
  const [fees, rules] = await Promise.all([getSetting('fees'), getSetting('auction.rules')]);

  const pre = await prisma.auction.findUnique({ where: { id: BigInt(auctionId) }, select: { status: true, endsAt: true } });
  if (!pre || !['LIVE', 'SCHEDULED'].includes(pre.status)) return { result: 'skipped', status: pre?.status };
  const [{ now: dbNow }] = await prisma.$queryRaw`SELECT UTC_TIMESTAMP(3) AS now`;
  const now = new Date(dbNow);
  if (now < pre.endsAt) return { result: 'not-due', rescheduleAt: pre.endsAt };
  const later = await settleLateFees(auctionId, pre.endsAt, now);
  if (later) return { result: 'not-due', rescheduleAt: later };

  const r = await withRetry(async (tx) => {
    const s = await lockAuction(tx, auctionId);
    if (s.status !== 'LIVE' && s.status !== 'SCHEDULED') return { result: 'skipped', status: s.status };
    if (s.now < s.endsAt) return { result: 'not-due', rescheduleAt: s.endsAt };

    // Fees never confirmed: those bids do not count. A late payment for them is refunded.
    await tx.bid.updateMany({ where: { auctionId: s.id, status: 'PENDING_PAYMENT' }, data: { status: 'VOID' } });
    const bids = await tx.bid.findMany({
      where: { auctionId: s.id, status: 'ACTIVE' },
      include: { bidder: { select: { id: true, status: true, firstName: true } } },
    });
    const statusOf = new Map(bids.map((b) => [b.bidderId, b.bidder.status]));
    const ranked = rankBids(bids);
    const winningBid = pickWinner(ranked, { isEligible: (id) => statusOf.get(id) === 'ACTIVE' });
    const { outcome, finalPrice } = closeOutcome({ winningBid, paidBids: bids.length, minPaidBids: s.minPaidBids });
    const sold = outcome === 'SOLD';

    const buyerPremium = sold ? applyBasisPoints(finalPrice, fees.buyerPremiumBp) : 0n;
    const paymentDeadline = sold ? new Date(s.now.getTime() + rules.paymentDeadlineHours * 3_600_000) : null;
    const winnerId = sold ? winningBid.bidderId : null;

    const result = await tx.auctionResult.create({
      data: {
        auctionId: s.id,
        outcome,
        status: sold ? 'AWAITING_PAYMENT' : 'CANCELLED',
        winnerId,
        winningBidId: sold ? winningBid.id : null,
        finalPrice,
        buyerPremium,
        totalDue: sold ? finalPrice + buyerPremium : null,
        paymentDeadline,
      },
    });
    await tx.auction.update({
      where: { id: s.id },
      data: { status: 'CLOSED', closedAt: s.now, bidCount: bids.length, ...(sold && { currentWinnerId: winnerId }) },
    });

    // Notifications are part of the close, so nobody is told before it is final.
    const loserIds = [...new Set(bids.map((b) => b.bidderId))].filter((id) => id !== winnerId);
    const data = { auctionId: s.id };
    if (sold) await notify(winnerId, 'AUCTION_WON', { title: s.title, amount: formatEtb(result.totalDue), hours: rules.paymentDeadlineHours }, data, tx);
    await notifyMany(loserIds, 'AUCTION_LOST', { title: s.title, noSale: !sold, feesRefunded: outcome === 'NOT_ENOUGH_BIDS' }, data, tx);

    return {
      result: 'closed',
      outcome,
      auctionResult: result,
      paidBids: bids.length,
      uniqueBids: ranked.filter((b) => b.unique).length,
      winnerAlias: sold ? bidderAlias(winningBid.bidder.firstName, s.id, winnerId, aliasSecret()) : null,
    };
  });

  if (r.result === 'closed') {
    const res = r.auctionResult;
    // Amounts may be revealed now that bidding is over.
    emitToAuction(auctionId, 'auction:closed', {
      auctionId,
      outcome: r.outcome,
      finalPrice: moneyDto(res.finalPrice),
      winnerAlias: r.winnerAlias,
      paidBids: r.paidBids,
      uniqueBids: r.uniqueBids,
    });
    if (res.winnerId) {
      emitToUser(res.winnerId, 'user:won', { auctionId, totalDue: moneyDto(res.totalDue), paymentDeadline: res.paymentDeadline });
    }
    logger.info({ auctionId: String(auctionId), outcome: r.outcome, paidBids: r.paidBids }, 'auction closed');
    await afterAuctionClosed(auctionId).catch((err) => logger.error({ err, auctionId: String(auctionId) }, 'post-close payment steps failed'));
  }
  return r;
}

// ───────────────────────────── Ending soon ─────────────────────────────

/** Reminds watchers and bidders shortly before the end. Sent once per auction. */
export async function sendEndingSoon(auctionId) {
  const a = await prisma.auction.findUnique({
    where: { id: BigInt(auctionId) },
    include: { product: { select: { title: true } }, watchers: { select: { userId: true } } },
  });
  if (!a || a.status !== 'LIVE') return { result: 'skipped' };
  const minutesLeft = Math.round((a.endsAt.getTime() - Date.now()) / 60_000);
  if (minutesLeft > ENDING_SOON_MINUTES + 1 || minutesLeft < 1) return { result: 'skipped', minutesLeft };

  const bidders = await prisma.bid.findMany({ where: { auctionId: a.id, status: 'ACTIVE' }, distinct: ['bidderId'], select: { bidderId: true } });
  const recipients = [...new Set([...a.watchers.map((w) => w.userId), ...bidders.map((b) => b.bidderId)])];
  const count = await notifyMany(recipients, 'AUCTION_ENDING_SOON', { title: a.product.title, minutes: minutesLeft }, { auctionId: a.id });
  return { result: 'sent', count };
}

// ───────────────────────────── Cancel ─────────────────────────────

/**
 * LOW BID staff may cancel any auction before it closes. Bidders and watchers are told why,
 * and every paid bid fee is refunded (setting auction.lowestUniqueBid.refundFeesOnCancel).
 */
export async function cancelAuction(auctionId, { reason, actorId, req }) {
  const r = await withRetry(async (tx) => {
    const s = await lockAuction(tx, auctionId);
    if (['CLOSED', 'CANCELLED'].includes(s.status)) throw conflict('AUCTION_ALREADY_FINISHED', `This auction is already ${s.status.toLowerCase()}`);

    await tx.auction.update({ where: { id: s.id }, data: { status: 'CANCELLED', cancelledReason: reason, cancelledById: BigInt(actorId) } });
    const [bidders, watchers] = await Promise.all([
      tx.bid.findMany({ where: { auctionId: s.id, status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } }, distinct: ['bidderId'], select: { bidderId: true } }),
      tx.auctionWatchlist.findMany({ where: { auctionId: s.id }, select: { userId: true } }),
    ]);
    const data = { auctionId: s.id };
    await notifyMany([...bidders.map((b) => b.bidderId), ...watchers.map((w) => w.userId)], 'AUCTION_CANCELLED', { title: s.title, reason }, data, tx);
    await recordAudit({
      actorId, action: 'auction.cancel', entity: 'auction', entityId: s.id,
      before: { status: s.status, bidCount: s.bidCount }, after: { reason }, req,
    }, tx);
    return { previousStatus: s.status };
  });
  emitToAuction(auctionId, 'auction:cancelled', { auctionId, reason });
  await afterAuctionCancelled(auctionId).catch((err) => logger.error({ err, auctionId: String(auctionId) }, 'bid fee refunds after cancel failed'));
  return r;
}

// ───────────────────────────── Safety net ─────────────────────────────

/** Every 30 s: start and close anything whose time has come, in case a job was lost. */
export async function sweep() {
  const [now] = await prisma.$queryRaw`SELECT UTC_TIMESTAMP(3) AS now`;
  const due = await prisma.auction.findMany({
    where: {
      OR: [
        { status: 'LIVE', endsAt: { lte: now.now } },
        { status: 'SCHEDULED', startsAt: { lte: now.now } },
      ],
    },
    select: { id: true, status: true },
    orderBy: { endsAt: 'asc' },
    take: 200,
  });
  let closed = 0;
  let started = 0;
  for (const a of due) {
    try {
      const r = a.status === 'LIVE' ? await closeAuction(a.id) : await startAuction(a.id);
      if (r.result === 'closed') closed += 1;
      if (r.result === 'started') { started += 1; await scheduleAuctionClose(r.auction); }
    } catch (err) {
      logger.error({ err, auctionId: String(a.id) }, 'sweep failed for auction');
    }
  }
  if (closed || started) logger.info({ closed, started }, 'sweep');
  return { closed, started };
}

/** On worker start: make sure every open auction has its jobs queued. */
export async function bootstrapSchedules() {
  const open = await prisma.auction.findMany({ where: { status: { in: ['SCHEDULED', 'LIVE'] } }, select: { id: true, status: true, startsAt: true, endsAt: true } });
  for (const a of open) await scheduleAuctionJobs(a);
  logger.info({ count: open.length }, 'auction jobs bootstrapped');
}
