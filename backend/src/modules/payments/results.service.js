import { prisma } from '../../config/prisma.js';
import { schedulePaymentDeadline, schedulePaymentReminder } from '../../jobs/queue.js';
import { emitToUser } from '../../sockets/realtime.js';
import { conflict, notFound } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { applyBasisPoints, formatEtb, moneyDto } from '../../utils/money.js';
import { recordAudit } from '../audit/audit.service.js';
import { notify } from '../notifications/notifications.service.js';
import { getSetting } from '../settings/settings.service.js';
import { pickWinner, rankBids } from '../auctions/auction.rules.js';
import { verifyAndSettle } from './payments.service.js';
import { refundBidFees } from './refunds.service.js';

/** Called after an auction closes (or a second-chance offer is made): deadline and reminder jobs. */
export async function scheduleResultJobs(result) {
  if (result.status !== 'AWAITING_PAYMENT' || !result.paymentDeadline) return;
  const { reminderHoursBeforeDeadline } = await getSetting('payment.chapa');
  await schedulePaymentDeadline(result);
  await schedulePaymentReminder(result, reminderHoursBeforeDeadline);
}

/** Hook for the auction lifecycle: after close, start the winner's payment clock (or refund fees if too few bids). */
export async function afterAuctionClosed(auctionId) {
  const result = await prisma.auctionResult.findUnique({ where: { auctionId: BigInt(auctionId) } });
  if (result?.outcome === 'NOT_ENOUGH_BIDS') await refundBidFees(auctionId, { reason: 'Auction did not reach its minimum number of bids' });
  if (result) await scheduleResultJobs(result);
}

export async function afterAuctionCancelled(auctionId) {
  const { refundFeesOnCancel } = await getSetting('auction.lowestUniqueBid');
  if (refundFeesOnCancel) await refundBidFees(auctionId, { reason: 'Auction cancelled' });
}

export async function sendPaymentReminder(resultId) {
  const r = await prisma.auctionResult.findUnique({ where: { id: BigInt(resultId) }, include: { auction: { include: { product: { select: { title: true } } } } } });
  if (!r || r.status !== 'AWAITING_PAYMENT' || !r.winnerId) return { result: 'skipped' };
  const hours = Math.max(1, Math.round((r.paymentDeadline.getTime() - Date.now()) / 3_600_000));
  await notify(r.winnerId, 'PAYMENT_REMINDER', { title: r.auction.product.title, hours }, { auctionId: r.auctionId });
  return { result: 'sent' };
}

/**
 * At the payment deadline. If the winner has not paid:
 *   1. give them a payment strike,
 *   2. offer the item to the next bidder in the ranking (next lowest unique bid, and so on)
 *      at their own bid amount (second chance),
 *   3. or, if nobody is left, end it as unsold.
 * A checkout still open at the deadline gets a short grace period first.
 */
export async function expireUnpaidResult(resultId) {
  const r0 = await prisma.auctionResult.findUnique({ where: { id: BigInt(resultId) } });
  if (!r0 || r0.status !== 'AWAITING_PAYMENT') return { result: 'skipped' };

  // Someone may have paid in the last seconds: settle anything pending first.
  const pending = await prisma.payment.findMany({ where: { resultId: r0.id, status: { in: ['PENDING', 'INITIATED'] } }, select: { txRef: true, createdAt: true } });
  for (const p of pending) await verifyAndSettle(p.txRef, { source: 'deadline' }).catch(() => {});
  const { checkoutTimeoutMinutes } = await getSetting('payment.chapa');
  const graceUntil = r0.paymentDeadline.getTime() + checkoutTimeoutMinutes * 60_000;
  const recentCheckout = pending.some((p) => p.createdAt.getTime() > r0.paymentDeadline.getTime() - checkoutTimeoutMinutes * 60_000);
  if (recentCheckout && Date.now() < graceUntil) {
    await schedulePaymentDeadline({ id: r0.id, paymentDeadline: new Date(graceUntil) });
    return { result: 'grace' };
  }

  const [rules, fees] = await Promise.all([getSetting('auction.rules'), getSetting('fees')]);

  const out = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`SELECT id, UTC_TIMESTAMP(3) AS now FROM auction_results WHERE id = ${r0.id} FOR UPDATE`;
    const now = new Date(rows[0].now);
    const r = await tx.auctionResult.findUnique({ where: { id: r0.id }, include: { auction: { include: { product: true } } } });
    if (r.status !== 'AWAITING_PAYMENT' || now < r.paymentDeadline) return { result: 'skipped' };
    const title = r.auction.product.title;
    const defaulter = r.winnerId;

    // 1. Strike.
    await tx.user.update({ where: { id: defaulter }, data: { paymentStrikes: { increment: 1 } } });
    await notify(defaulter, 'PAYMENT_EXPIRED', { title }, { auctionId: r.auctionId }, tx);

    // 2. Second chance.
    const history = Array.isArray(r.offerHistory) ? r.offerHistory : [];
    history.push({ userId: String(defaulter), finalPrice: String(r.finalPrice), expiredAt: now.toISOString(), offerRank: r.offerRank });
    const excluded = new Set([...history.map((h) => BigInt(h.userId))]);
    let offer = null;
    if (rules.secondChanceOffer) {
      const bids = await tx.bid.findMany({ where: { auctionId: r.auctionId, status: 'ACTIVE' }, include: { bidder: { select: { status: true, paymentStrikes: true } } } });
      const status = new Map(bids.map((b) => [b.bidderId, b.bidder]));
      offer = pickWinner(rankBids(bids), {
        excluded,
        isEligible: (id) => status.get(id)?.status === 'ACTIVE' && status.get(id).paymentStrikes < rules.maxPaymentStrikes,
      });
    }

    if (offer) {
      const premium = applyBasisPoints(offer.amount, fees.buyerPremiumBp);
      const updated = await tx.auctionResult.update({
        where: { id: r.id },
        data: {
          winnerId: offer.bidderId,
          winningBidId: offer.id,
          finalPrice: offer.amount,
          buyerPremium: premium,
          totalDue: offer.amount + premium,
          offerRank: r.offerRank + 1,
          offerHistory: history,
          paymentDeadline: new Date(now.getTime() + rules.paymentDeadlineHours * 3_600_000),
        },
      });
      await tx.auction.update({ where: { id: r.auctionId }, data: { currentWinnerId: offer.bidderId } });
      await notify(offer.bidderId, 'SECOND_CHANCE_OFFER', { title, amount: formatEtb(updated.totalDue), hours: rules.paymentDeadlineHours }, { auctionId: r.auctionId }, tx);
      await recordAudit({ actorId: null, action: 'result.second_chance', entity: 'auction_result', entityId: r.id, before: { winnerId: defaulter }, after: { winnerId: offer.bidderId, finalPrice: offer.amount } }, tx);
      return { result: 'second-chance', updated, newWinner: offer.bidderId };
    }

    // 3. Nobody left.
    const updated = await tx.auctionResult.update({ where: { id: r.id }, data: { status: 'PAYMENT_EXPIRED', offerHistory: history } });
    await recordAudit({ actorId: null, action: 'result.payment_expired', entity: 'auction_result', entityId: r.id, before: { winnerId: defaulter } }, tx);
    return { result: 'expired', updated };
  });

  if (out.result === 'second-chance') {
    await scheduleResultJobs(out.updated);
    emitToUser(out.newWinner, 'user:won', { auctionId: out.updated.auctionId, totalDue: moneyDto(out.updated.totalDue), paymentDeadline: out.updated.paymentDeadline, secondChance: true });
  }
  if (out.result !== 'skipped') logger.info({ resultId: String(r0.id), outcome: out.result }, 'payment deadline handled');
  return { result: out.result };
}

// ───────────────────────────── Delivery (LOW BID fulfils every order) ─────────────────────────────

const presentOrder = (r) => ({
  id: r.id.toString(),
  auctionId: r.auctionId.toString(),
  title: r.auction?.product?.title,
  status: r.status,
  finalPrice: moneyDto(r.finalPrice),
  totalDue: moneyDto(r.totalDue),
  paidAt: r.paidAt,
  fulfilledAt: r.fulfilledAt,
  confirmedAt: r.confirmedAt,
  winner: r.winner ? { id: r.winner.id.toString(), name: `${r.winner.firstName} ${r.winner.lastName}`, phone: r.winner.phone } : null,
});

/**
 * Won items for staff: by default the ones paid and waiting for delivery.
 * @param {{ status?: string, page: number, pageSize: number }} q
 */
export async function listOrders({ status = 'PAID', page, pageSize }) {
  const where = { outcome: 'SOLD', status };
  const [total, rows] = await Promise.all([
    prisma.auctionResult.count({ where }),
    prisma.auctionResult.findMany({
      where,
      include: { auction: { include: { product: { select: { title: true } } } }, winner: { select: { id: true, firstName: true, lastName: true, phone: true } } },
      orderBy: { paidAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { data: rows.map(presentOrder), meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}

/** Staff record that LOW BID delivered or handed over the item. The winner is told. */
export async function markDelivered(resultId, { note, actorId, req }) {
  const r = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`SELECT id FROM auction_results WHERE id = ${BigInt(resultId)} FOR UPDATE`;
    if (!rows.length) throw notFound('RESULT_NOT_FOUND', 'Order not found');
    const res = await tx.auctionResult.findUnique({ where: { id: rows[0].id }, include: { auction: { include: { product: { select: { title: true } } } } } });
    if (res.status === 'FULFILLED') return res;
    if (res.status !== 'PAID') throw conflict('ORDER_NOT_PAID', `This order is ${res.status.toLowerCase().replace('_', ' ')}; only paid orders can be delivered`);
    const updated = await tx.auctionResult.update({ where: { id: res.id }, data: { status: 'FULFILLED', fulfilledAt: new Date() } });
    const { disputeWindowDays } = await getSetting('orders.policy');
    await notify(res.winnerId, 'ITEM_DELIVERED', { title: res.auction.product.title, days: disputeWindowDays }, { auctionId: res.auctionId }, tx);
    await recordAudit({ actorId, action: 'order.delivered', entity: 'auction_result', entityId: res.id, after: { note }, req }, tx);
    return updated;
  });
  return { id: r.id.toString(), status: r.status, fulfilledAt: r.fulfilledAt };
}

/** The winner confirms the item arrived as described. This closes refund requests for the order. */
export async function confirmReceived(userId, auctionId, { req }) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`SELECT id FROM auction_results WHERE auction_id = ${BigInt(auctionId)} FOR UPDATE`;
    if (!rows.length) throw notFound('RESULT_NOT_FOUND', 'Auction result not found');
    const r = await tx.auctionResult.findUnique({ where: { id: rows[0].id } });
    if (r.winnerId !== BigInt(userId)) throw notFound('RESULT_NOT_FOUND', 'Auction result not found');
    if (r.confirmedAt) return { status: r.status };
    if (!['PAID', 'FULFILLED'].includes(r.status)) throw conflict('NOT_PAID', 'Confirm receipt after paying, and not while a refund request is open');
    const now = new Date();
    await tx.auctionResult.update({ where: { id: r.id }, data: { status: 'FULFILLED', confirmedAt: now, fulfilledAt: r.fulfilledAt ?? now } });
    await recordAudit({ actorId: userId, action: 'result.confirm_received', entity: 'auction_result', entityId: r.id, req }, tx);
    return { status: 'FULFILLED' };
  });
}
