import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { scheduleRefund } from '../../jobs/queue.js';
import { chapa, chapaMessage } from '../../services/chapa/client.js';
import { newObjectId } from '../../services/storage/keys.js';
import { emitToAuction, emitToUser } from '../../sockets/realtime.js';
import { AppError, conflict, forbidden, notFound } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { formatEtb, minorToEtb, moneyDto } from '../../utils/money.js';
import { recordAudit } from '../audit/audit.service.js';
import { lockAuction } from '../auctions/auction.lock.js';
import { notify } from '../notifications/notifications.service.js';
import { getSetting } from '../settings/settings.service.js';
import { writeLedger } from './ledger.service.js';
import { buildTxRef, chapaPhone, chapaText, classifyVerification, computeSettlement, ledger, receiptNumber } from './payment.rules.js';
import { presentPayment } from './payment.presenter.js';
import { createPayoutInTx } from './payouts.service.js';
import { createRefundInTx } from './refunds.service.js';

const FINAL = new Set(['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED', 'FAILED']);
const POLL_MIN_INTERVAL_MS = 5_000;

async function lockPaymentByRef(tx, txRef) {
  const rows = await tx.$queryRaw`SELECT id FROM payments WHERE tx_ref = ${txRef} FOR UPDATE`;
  if (!rows.length) return null;
  return tx.payment.findUnique({ where: { id: rows[0].id }, include: { bid: true } });
}

// ───────────────────────────── Starting a checkout ─────────────────────────────

/** Asks Chapa for a hosted checkout page. Only the checkout URL ever reaches the app. */
export async function initializeWithChapa(payment, user, { auctionId, purpose }) {
  const label = purpose === 'BID_FEE' ? 'Bid fee' : 'Payment';
  let res;
  try {
    res = await chapa.initialize({
      amount: minorToEtb(payment.amount),
      currency: 'ETB',
      tx_ref: payment.txRef,
      first_name: user.firstName,
      last_name: user.lastName,
      ...(user.email && { email: user.email }),
      ...(chapaPhone(user.phone) && { phone_number: chapaPhone(user.phone) }),
      callback_url: env.chapaCallbackUrl,
      return_url: `${env.chapaReturnUrl}?tx_ref=${encodeURIComponent(payment.txRef)}`,
      customization: { title: 'LOW BID', description: chapaText(`${label} for auction ${auctionId}`, 50) },
      meta: { payment_id: payment.id.toString(), purpose },
    });
  } catch (err) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: 'Provider unreachable at checkout' } });
    throw err;
  }
  const url = res.body?.data?.checkout_url;
  if (res.httpStatus !== 200 || !url) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: `Initialize refused: ${chapaMessage(res)}` } });
    logger.error({ txRef: payment.txRef, status: res.httpStatus, message: chapaMessage(res) }, 'chapa initialize refused');
    throw new AppError(502, 'PAYMENT_INIT_FAILED', 'The payment could not be started. Try again in a moment');
  }
  return prisma.payment.update({ where: { id: payment.id }, data: { status: 'PENDING', checkoutUrl: url } });
}

export const checkoutResponse = (p, reused) => ({ ...presentPayment(p), reused });

/** The winner pays for the item. The amount is always computed here, never sent by the app. */
export async function startWinnerCheckout(userId, auctionId) {
  const [{ checkoutTimeoutMinutes }, fees] = await Promise.all([getSetting('payment.chapa'), getSetting('fees.commission')]);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: BigInt(userId) } });

  const { payment, reused } = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`SELECT id, UTC_TIMESTAMP(3) AS now FROM auction_results WHERE auction_id = ${BigInt(auctionId)} FOR UPDATE`;
    if (!rows.length) throw notFound('RESULT_NOT_FOUND', 'Nothing to pay for this auction');
    const now = new Date(rows[0].now);
    const r = await tx.auctionResult.findUnique({ where: { id: rows[0].id }, include: { auction: { select: { sellerPrice: true } } } });
    if (r.winnerId !== BigInt(userId)) throw forbidden('NOT_THE_WINNER', 'Only the winner can pay for this item');
    if (r.status === 'PAID' || r.status === 'FULFILLED') throw conflict('ALREADY_PAID', 'You have already paid for this item');
    if (r.status !== 'AWAITING_PAYMENT') throw conflict('PAYMENT_NOT_OPEN', 'This item can no longer be paid for');
    if (now >= r.paymentDeadline) throw conflict('PAYMENT_DEADLINE_PASSED', 'The payment deadline has passed');

    const open = await tx.payment.findFirst({ where: { resultId: r.id, userId: BigInt(userId), status: 'PENDING', expiresAt: { gt: now }, checkoutUrl: { not: null } }, orderBy: { id: 'desc' } });
    const s = computeSettlement({ finalPrice: r.finalPrice, buyerPremium: r.buyerPremium, sellerPrice: r.auction.sellerPrice, sellerCommissionBp: fees.sellerCommissionBp });
    if (open && open.amount === s.cashDue) return { payment: open, reused: true };

    const p = await tx.payment.create({
      data: {
        txRef: buildTxRef('WINNING_BID', BigInt(auctionId), newObjectId()),
        purpose: 'WINNING_BID',
        auctionId: BigInt(auctionId),
        resultId: r.id,
        userId: BigInt(userId),
        amount: s.cashDue,
        currency: 'ETB',
        status: 'INITIATED',
        expiresAt: new Date(Math.min(now.getTime() + checkoutTimeoutMinutes * 60_000, r.paymentDeadline.getTime())),
      },
    });
    return { payment: p, reused: false };
  });

  if (reused) return checkoutResponse(payment, true);
  return checkoutResponse(await initializeWithChapa(payment, user, { auctionId, purpose: 'WINNING_BID' }), false);
}

// ───────────────────────────── Verification and settlement ─────────────────────────────

/**
 * The only way a payment becomes PAID. Called from the webhook, the callback, the return page,
 * status polling and the reconcile job; whichever arrives first settles, the rest find it done.
 * @returns {Promise<{ status: string, settled?: boolean }>}
 */
export async function verifyAndSettle(txRef, { source }) {
  const payment = await prisma.payment.findUnique({ where: { txRef } });
  if (!payment) return { status: 'UNKNOWN' };
  if (FINAL.has(payment.status)) return { status: payment.status };

  const res = await chapa.verify(txRef);
  const v = classifyVerification(payment, res, { expectLive: env.chapaExpectLive });
  await prisma.payment.update({ where: { id: payment.id }, data: { lastCheckedAt: new Date() } });

  if (v.state === 'pending' || v.state === 'not_found' || v.state === 'error') {
    if (v.state === 'error') logger.warn({ txRef, reason: v.reason, source }, 'chapa verify inconclusive');
    return { status: payment.status };
  }
  if (v.state === 'failed') return markFailed(payment, v.reason, res.body);
  if (v.state === 'mismatch') {
    // Chapa says paid, but not what we asked for. Never fulfil; flag for a person.
    logger.error({ txRef, reason: v.reason, source }, 'PAYMENT MISMATCH: needs manual review');
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: `NEEDS_REVIEW: ${v.reason}`, verifyPayload: res.body } });
    return { status: 'FAILED', needsReview: true };
  }
  return settle(txRef, v, res.body, source);
}

async function markFailed(payment, reason, body) {
  const updated = await prisma.$transaction(async (tx) => {
    const p = await lockPaymentByRef(tx, payment.txRef);
    if (FINAL.has(p.status)) return null;
    await tx.payment.update({ where: { id: p.id }, data: { status: 'FAILED', failureReason: reason, verifyPayload: body } });
    // An unpaid bid fee: the bid never counts, and the amount is free to bid again.
    await tx.bid.updateMany({ where: { paymentId: p.id, status: 'PENDING_PAYMENT' }, data: { status: 'VOID' } });
    return p;
  });
  if (updated) {
    const title = await titleFor(updated);
    await notify(updated.userId, 'PAYMENT_FAILED', { title }, { txRef: updated.txRef });
    emitToUser(updated.userId, 'payment:updated', { txRef: updated.txRef, status: 'FAILED' });
  }
  return { status: 'FAILED' };
}

async function titleFor(p, db = prisma) {
  if (!p.auctionId) return 'your item';
  const a = await db.auction.findUnique({ where: { id: p.auctionId }, include: { product: { select: { title: true } } } });
  return a?.product.title ?? 'your item';
}

async function settle(txRef, v, body, source) {
  const [fees] = await Promise.all([getSetting('fees.commission')]);
  const out = await prisma.$transaction(async (tx) => {
    const p = await lockPaymentByRef(tx, txRef);
    if (FINAL.has(p.status)) return { status: p.status, already: true };
    const paidAt = new Date();
    const paid = await tx.payment.update({
      where: { id: p.id },
      data: {
        status: 'PAID',
        verifiedAt: paidAt,
        providerRef: v.providerRef,
        providerFee: v.fee,
        paymentMethod: v.method?.slice(0, 40),
        verifyPayload: body,
        receiptNo: receiptNumber(p.id, paidAt),
        failureReason: null,
      },
    });
    const refs = { paymentId: p.id };
    if (v.fee > 0n) await writeLedger(tx, ledger.providerFee(v.fee), refs);
    const title = await titleFor(p, tx);
    const effects = { refundIds: [], events: [] };

    if (p.purpose === 'BID_FEE') {
      await writeLedger(tx, ledger.bidFeePaid(p.amount), refs);
      const bid = p.bid;
      // Same lock order as everywhere else (payment, then auction), so this cannot race the close.
      const s = bid ? await lockAuction(tx, bid.auctionId) : null;
      const open = s && ['SCHEDULED', 'LIVE'].includes(s.status) && bid.status === 'PENDING_PAYMENT';
      if (open) {
        // The bid counts from now. Bidding may have ended a moment ago: the close waits a few
        // minutes for fees still being confirmed, so a bid paid in time is never lost.
        await tx.bid.update({ where: { id: bid.id }, data: { status: 'ACTIVE', activatedAt: s.now } });
        const startsNow = s.status === 'SCHEDULED' && s.now >= s.startsAt;
        const a = await tx.auction.update({ where: { id: s.id }, data: { bidCount: { increment: 1 }, version: { increment: 1 }, ...(startsNow && { status: 'LIVE' }) } });
        await notify(p.userId, 'BID_CONFIRMED', { title, amount: formatEtb(bid.amount) }, { auctionId: s.id, txRef }, tx);
        effects.auctionEvents = [{ auctionId: s.id, bidCount: a.bidCount, startsNow, endsAt: a.endsAt }];
        effects.events.push({ userId: p.userId, payload: { txRef, status: 'PAID', purpose: 'BID_FEE', auctionId: s.id, bidId: bid.id, bidStatus: 'ACTIVE' } });
        return { status: 'PAID', settled: true, effects };
      }
      // Paid after bidding closed, after the checkout expired, or for a cancelled auction: refund it.
      if (bid && bid.status === 'PENDING_PAYMENT') await tx.bid.update({ where: { id: bid.id }, data: { status: 'VOID' } });
      const r = await createRefundInTx(tx, { payment: paid, kind: 'BID_FEE_REFUND', amount: p.amount, reason: 'Bid fee paid after bidding closed' });
      effects.refundIds.push(r.id);
      effects.events.push({ userId: p.userId, payload: { txRef, status: 'PAID', purpose: 'BID_FEE', auctionId: p.auctionId, bidId: bid?.id, bidStatus: 'VOID', refunding: true } });
      return { status: 'PAID', settled: false, effects };
    }

    // WINNING_BID
    const rows = await tx.$queryRaw`SELECT id FROM auction_results WHERE id = ${p.resultId} FOR UPDATE`;
    const result = rows.length ? await tx.auctionResult.findUnique({ where: { id: p.resultId }, include: { auction: { include: { product: true } } } }) : null;
    const s = result && computeSettlement({ finalPrice: result.finalPrice, buyerPremium: result.buyerPremium, sellerPrice: result.auction.sellerPrice, sellerCommissionBp: fees.sellerCommissionBp });
    const applicable = result
      && result.status === 'AWAITING_PAYMENT'
      && result.winnerId === p.userId
      && s.cashDue === p.amount;

    if (!applicable) {
      // Paid too late, or the offer moved to another bidder: hold it and refund it in full.
      await writeLedger(tx, ledger.unappliedReceived(p.amount), refs);
      const r = await createRefundInTx(tx, { payment: paid, kind: 'LATE_PAYMENT', amount: p.amount, reason: 'Payment arrived after the offer ended' });
      effects.refundIds.push(r.id);
      effects.events.push({ userId: p.userId, payload: { txRef, status: 'PAID', refunding: true } });
      logger.warn({ txRef, source }, 'payment not applicable, refunding');
      return { status: 'PAID', settled: false, effects };
    }

    await writeLedger(tx, ledger.salePaid(s), refs);
    await tx.auctionResult.update({ where: { id: result.id }, data: { status: 'PAID', paidAt } });
    await tx.commission.create({
      data: {
        paymentId: p.id,
        sellerId: result.auction.product.sellerId,
        saleAmount: result.finalPrice,
        buyerPremium: result.buyerPremium,
        sellerCommission: s.commission,
        rateBasisPoints: fees.sellerCommissionBp,
      },
    });
    await createPayoutInTx(tx, { result, payment: paid, settlement: s, sellerId: result.auction.product.sellerId, paidAt });
    const seller = await tx.sellerProfile.findUnique({ where: { id: result.auction.product.sellerId }, select: { userId: true } });
    await notify(p.userId, 'PAYMENT_SUCCESS', { title, amount: formatEtb(p.amount), receiptNo: paid.receiptNo }, { auctionId: result.auctionId, txRef }, tx);
    await notify(seller.userId, 'SALE_PAID', { title, amount: formatEtb(s.sellerNet) }, { auctionId: result.auctionId }, tx);
    await recordAudit({ actorId: null, action: 'payment.settled', entity: 'payment', entityId: p.id, after: { source, amount: p.amount, receiptNo: paid.receiptNo } }, tx);
    effects.events.push({ userId: p.userId, payload: { txRef, status: 'PAID', purpose: 'WINNING_BID', auctionId: result.auctionId, receiptNo: paid.receiptNo } });
    return { status: 'PAID', settled: true, effects };
  });

  for (const id of out.effects?.refundIds ?? []) await scheduleRefund(id);
  for (const ev of out.effects?.auctionEvents ?? []) {
    // Only the count: amounts stay secret until the close.
    if (ev.startsNow) emitToAuction(ev.auctionId, 'auction:started', { auctionId: ev.auctionId, endsAt: ev.endsAt });
    emitToAuction(ev.auctionId, 'auction:bid', { auctionId: ev.auctionId, bidCount: ev.bidCount });
  }
  for (const e of out.effects?.events ?? []) emitToUser(e.userId, 'payment:updated', e.payload);
  return { status: out.status, settled: out.settled ?? false };
}

// ───────────────────────────── Status, history, receipts ─────────────────────────────

async function loadOwn(userId, txRef, { allowAdmin = false } = {}) {
  const p = await prisma.payment.findUnique({ where: { txRef }, include: { result: true, bid: true } });
  if (!p || (!allowAdmin && p.userId !== BigInt(userId))) throw notFound('PAYMENT_NOT_FOUND', 'Payment not found');
  return p;
}

/** The app polls this after Chapa's page closes; it re-checks Chapa at most every 5 seconds. */
export async function paymentStatus(userId, txRef) {
  let p = await loadOwn(userId, txRef);
  const stale = !p.lastCheckedAt || Date.now() - p.lastCheckedAt.getTime() > POLL_MIN_INTERVAL_MS;
  if (['INITIATED', 'PENDING', 'EXPIRED'].includes(p.status) && stale) {
    await verifyAndSettle(txRef, { source: 'poll' }).catch((err) => logger.warn({ err, txRef }, 'poll verify failed'));
    p = await loadOwn(userId, txRef);
  }
  return presentPayment(p);
}

export async function paymentHistory(userId, { page, pageSize }) {
  const where = { userId: BigInt(userId), status: { not: 'INITIATED' } };
  const [total, rows] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { result: true, bid: true } }),
  ]);
  return { data: rows.map((p) => presentPayment(p)), meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}

export async function receipt(userId, txRef, { isAdmin = false } = {}) {
  const p = await loadOwn(userId, txRef, { allowAdmin: isAdmin });
  if (!['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(p.status)) throw conflict('NO_RECEIPT', 'A receipt is available once the payment is confirmed');
  const [user, title, refunds] = await Promise.all([
    prisma.user.findUnique({ where: { id: p.userId }, select: { firstName: true, lastName: true, phone: true } }),
    titleFor(p),
    prisma.refund.findMany({ where: { paymentId: p.id, status: 'PROCESSED' }, orderBy: { processedAt: 'asc' } }),
  ]);
  return {
    receiptNo: p.receiptNo,
    issuedAt: p.verifiedAt,
    seller: { name: 'LOW BID', note: 'Online auction marketplace, Ethiopia' },
    customer: { name: `${user.firstName} ${user.lastName}`, phone: user.phone },
    item: title,
    purpose: p.purpose,
    lines: [
      ...(p.purpose === 'WINNING_BID' && p.result
        ? [
            { label: 'Winning bid', amount: moneyDto(p.result.finalPrice) },
            ...(p.result.buyerPremium > 0n ? [{ label: 'Buyer premium', amount: moneyDto(p.result.buyerPremium) }] : []),
          ]
        : [{ label: 'Bid fee', amount: moneyDto(p.amount) }]),
    ],
    totalPaid: moneyDto(p.amount),
    refunds: refunds.map((r) => ({ amount: moneyDto(r.amount), at: r.processedAt, reference: r.providerRef })),
    paymentMethod: p.paymentMethod,
    providerReference: p.providerRef,
    txRef: p.txRef,
    status: p.status,
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const etbText = (m) => (m ? `ETB ${Number(m.etb).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '');

/** Printable receipt; the app shows it and can save it as PDF with the system print dialog. */
export function receiptHtml(r) {
  const rows = r.lines.map((l) => `<tr><td>${esc(l.label)}</td><td class="n">${esc(etbText(l.amount))}</td></tr>`).join('');
  const refunds = r.refunds.map((x) => `<tr><td>Refund ${esc(x.reference ?? '')}</td><td class="n">-${esc(etbText(x.amount))}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LOW BID receipt ${esc(r.receiptNo)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:24px auto;padding:0 16px;color:#14181C}h1{font-size:20px;margin:0}
.muted{color:#5f6b73;font-size:13px}table{width:100%;border-collapse:collapse;margin-top:16px}td{padding:8px 0;border-bottom:1px solid #e6e2da}
.n{text-align:right;font-variant-numeric:tabular-nums}.total td{font-weight:700;border-bottom:2px solid #0F4C5C}.brand{color:#0F4C5C;font-weight:800;letter-spacing:.04em}</style></head>
<body><div class="brand">LOW BID</div><h1>Payment receipt</h1>
<p class="muted">Receipt ${esc(r.receiptNo)} · ${esc(new Date(r.issuedAt).toISOString().slice(0, 16).replace('T', ' '))} UTC</p>
<p><strong>${esc(r.customer.name)}</strong><br><span class="muted">${esc(r.customer.phone)}</span></p>
<p>${esc(r.item)}</p>
<table>${rows}<tr class="total"><td>Total paid</td><td class="n">${esc(etbText(r.totalPaid))}</td></tr>${refunds}</table>
<p class="muted">Paid with ${esc(r.paymentMethod ?? 'Chapa')} · Chapa reference ${esc(r.providerReference ?? '')} · ${esc(r.txRef)}</p>
</body></html>`;
}

// ───────────────────────────── Reconciliation ─────────────────────────────

/**
 * Every few minutes: re-verify payments still pending, and expire the ones nobody completed.
 * An expired payment can still settle later if Chapa reports it paid (then it is refunded if
 * it no longer applies).
 */
export async function reconcilePayments() {
  const cfg = await getSetting('payment.chapa');
  const olderThan = new Date(Date.now() - cfg.reconcileAfterMinutes * 60_000);
  const pending = await prisma.payment.findMany({
    where: { status: { in: ['PENDING', 'INITIATED'] }, createdAt: { lte: olderThan } },
    select: { id: true, txRef: true, status: true, expiresAt: true },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  let settled = 0;
  let expired = 0;
  for (const p of pending) {
    try {
      const r = p.status === 'INITIATED' ? { status: 'INITIATED' } : await verifyAndSettle(p.txRef, { source: 'reconcile' });
      if (r.status === 'PAID') settled += 1;
      // 10-minute grace after expiry for slow mobile-money confirmations.
      if (['PENDING', 'INITIATED'].includes(r.status) && p.expiresAt.getTime() + 10 * 60_000 < Date.now()) {
        const { count } = await prisma.payment.updateMany({ where: { id: p.id, status: { in: ['PENDING', 'INITIATED'] } }, data: { status: 'EXPIRED' } });
        expired += count;
        // An expired bid fee: that bid never counts (if Chapa later reports it paid, it is refunded).
        if (count) await prisma.bid.updateMany({ where: { paymentId: p.id, status: 'PENDING_PAYMENT' }, data: { status: 'VOID' } });
      }
    } catch (err) {
      logger.error({ err, txRef: p.txRef }, 'reconcile failed for payment');
    }
  }
  // Recently expired payments: one last look in case Chapa completed them late.
  const recentExpired = await prisma.payment.findMany({
    where: { status: 'EXPIRED', expiresAt: { gte: new Date(Date.now() - 24 * 3_600_000) }, OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lte: new Date(Date.now() - 60 * 60_000) } }] },
    select: { txRef: true },
    take: 50,
  });
  for (const p of recentExpired) await verifyAndSettle(p.txRef, { source: 'reconcile-expired' }).catch(() => {});
  return { checked: pending.length, settled, expired };
}
