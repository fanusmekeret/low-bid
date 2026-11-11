import { prisma } from '../../config/prisma.js';
import { scheduleRefund } from '../../jobs/queue.js';
import { chapa, chapaMessage } from '../../services/chapa/client.js';
import { newObjectId } from '../../services/storage/keys.js';
import { emitToUser } from '../../sockets/realtime.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { formatEtb, minorToEtb } from '../../utils/money.js';
import { recordAudit } from '../audit/audit.service.js';
import { notify } from '../notifications/notifications.service.js';
import { getSetting } from '../settings/settings.service.js';
import { writeLedger } from './ledger.service.js';
import { ledger, refundableAmount } from './payment.rules.js';

const MAX_ATTEMPTS = 5;
const OPEN = ['REQUESTED', 'APPROVED', 'PROCESSING'];

async function lockRefund(tx, id) {
  const rows = await tx.$queryRaw`SELECT id FROM refunds WHERE id = ${BigInt(id)} FOR UPDATE`;
  if (!rows.length) throw notFound('REFUND_NOT_FOUND', 'Refund not found');
  return tx.refund.findUnique({ where: { id: BigInt(id) }, include: { payment: true } });
}

async function openRefundTotal(db, paymentId, excludeId) {
  const agg = await db.refund.aggregate({ where: { paymentId, status: { in: OPEN }, ...(excludeId && { NOT: { id: excludeId } }) }, _sum: { amount: true } });
  return agg._sum.amount ?? 0n;
}

/**
 * Creates a refund inside the caller's transaction (the caller holds the payment lock).
 * Automatic refunds start APPROVED; buyer requests start REQUESTED and wait for an admin.
 */
export async function createRefundInTx(tx, { payment, kind, amount, reason, requestedById = null, status = 'APPROVED' }) {
  const pending = await openRefundTotal(tx, payment.id);
  const max = refundableAmount(payment, pending);
  if (amount <= 0n || amount > max) {
    throw badRequest('REFUND_AMOUNT_INVALID', `You can refund at most ${formatEtb(max)} on this payment`, { maxRefundable: minorToEtb(max) });
  }
  return tx.refund.create({
    data: {
      paymentId: payment.id,
      kind,
      reference: `LB-RF-${payment.id}-${newObjectId()}`,
      amount,
      reason: reason.slice(0, 500),
      status,
      requestedById: requestedById === null ? null : BigInt(requestedById),
    },
  });
}

/**
 * Refunds every paid bid fee on an auction (cancelled, or closed without enough bids).
 * Runs after the auction change has committed. Safe to repeat: a fee already refunded (or
 * being refunded) has nothing left to refund.
 */
export async function refundBidFees(auctionId, { reason }) {
  const payments = await prisma.payment.findMany({
    where: { auctionId: BigInt(auctionId), purpose: 'BID_FEE', status: 'PAID' },
    select: { id: true },
  });
  const created = [];
  for (const { id } of payments) {
    try {
      const refund = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM payments WHERE id = ${id} FOR UPDATE`;
        const p = await tx.payment.findUnique({ where: { id } });
        const left = refundableAmount(p, await openRefundTotal(tx, p.id));
        if (left <= 0n) return null;
        return createRefundInTx(tx, { payment: p, kind: 'BID_FEE_REFUND', amount: left, reason });
      });
      if (refund) created.push(refund.id);
    } catch (err) {
      logger.error({ err, paymentId: String(id) }, 'bid fee refund failed');
    }
  }
  for (const id of created) await scheduleRefund(id);
  return created.length;
}

/**
 * Sends one approved refund to Chapa. Safe to call repeatedly: only an APPROVED refund is
 * claimed, and Chapa receives our unique reference so it can reject a duplicate.
 */
export async function processRefund(refundId) {
  const { refundMode } = await getSetting('payment.chapa');
  if (refundMode === 'MANUAL') return { result: 'manual' };

  const claimed = await prisma.$transaction(async (tx) => {
    const r = await lockRefund(tx, refundId);
    if (r.status !== 'APPROVED') return null;
    if (r.attempts >= MAX_ATTEMPTS) {
      await tx.refund.update({ where: { id: r.id }, data: { status: 'FAILED', failureReason: 'Too many attempts. Check the Chapa dashboard, then retry or mark it processed' } });
      return null;
    }
    await tx.refund.update({ where: { id: r.id }, data: { status: 'PROCESSING', providerStatus: 'sending', attempts: { increment: 1 } } });
    return r;
  });
  if (!claimed) return { result: 'skipped' };

  let res;
  try {
    res = await chapa.refund(claimed.payment.txRef, { amount: minorToEtb(claimed.amount), reason: claimed.reason.slice(0, 200), reference: claimed.reference });
  } catch (err) {
    // Network trouble: put it back so the next run retries it.
    await prisma.refund.update({ where: { id: claimed.id }, data: { status: 'APPROVED', providerStatus: null, failureReason: err.message?.slice(0, 500) } });
    return { result: 'retry' };
  }

  const ok = res.httpStatus >= 200 && res.httpStatus < 300 && String(res.body?.status ?? '').toLowerCase() === 'success';
  if (!ok) {
    await prisma.refund.update({ where: { id: claimed.id }, data: { status: 'FAILED', providerStatus: 'rejected', failureReason: chapaMessage(res) } });
    logger.error({ refundId: String(claimed.id), status: res.httpStatus, message: chapaMessage(res) }, 'chapa refused refund');
    return { result: 'failed' };
  }
  const refId = res.body?.data?.ref_id ?? res.body?.data?.reference ?? res.body?.ref_id ?? null;
  await prisma.refund.update({ where: { id: claimed.id }, data: { providerRef: refId, providerStatus: res.body?.data?.status ?? 'initiated', failureReason: null } });
  // Chapa may already report it as done; otherwise the reconcile job checks later.
  if (refId) return checkRefund(claimed.id);
  return { result: 'sent' };
}

/** Asks Chapa where a PROCESSING refund stands and completes or fails it. */
export async function checkRefund(refundId) {
  const r = await prisma.refund.findUnique({ where: { id: BigInt(refundId) } });
  if (!r || r.status !== 'PROCESSING' || !r.providerRef) return { result: 'skipped' };
  const res = await chapa.verifyRefund(r.providerRef);
  const status = String(res.body?.data?.status ?? '').toLowerCase();
  if (res.httpStatus !== 200 || !status) return { result: 'unknown' };
  if (status === 'refunded') {
    await completeRefund(r.id, { providerRef: r.providerRef });
    return { result: 'completed' };
  }
  if (status === 'reversed') {
    await prisma.refund.update({ where: { id: r.id }, data: { status: 'FAILED', providerStatus: status, failureReason: 'Chapa reversed the refund to the merchant balance' } });
    return { result: 'failed' };
  }
  await prisma.refund.update({ where: { id: r.id }, data: { providerStatus: status } });
  return { result: 'pending', status };
}

/**
 * Money has gone back to the customer: update the payment, ledger and result.
 * Used by Chapa confirmation and by an admin recording a manual refund.
 */
export async function completeRefund(refundId, { providerRef, actorId = null, req } = {}) {
  const done = await prisma.$transaction(async (tx) => {
    const r = await lockRefund(tx, refundId);
    if (!['PROCESSING', 'APPROVED'].includes(r.status)) return null;
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${r.paymentId} FOR UPDATE`;
    const payment = await tx.payment.findUnique({ where: { id: r.paymentId }, include: { result: { include: { auction: { include: { product: { select: { title: true } } } } } } } });

    const refunded = payment.refundedAmount + r.amount;
    await tx.payment.update({ where: { id: payment.id }, data: { refundedAmount: refunded, status: refunded >= payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
    await tx.refund.update({ where: { id: r.id }, data: { status: 'PROCESSED', processedAt: new Date(), providerRef: providerRef ?? r.providerRef, providerStatus: 'refunded' } });

    let lines;
    if (r.kind === 'BID_FEE_REFUND' || payment.purpose === 'BID_FEE') {
      lines = ledger.bidFeeRefunded(r.amount);
    } else if (r.kind === 'LATE_PAYMENT') {
      lines = ledger.unappliedRefunded(r.amount);
    } else {
      lines = ledger.saleRefunded(r.amount);
      if (refunded >= payment.amount && payment.resultId) {
        await tx.auctionResult.update({ where: { id: payment.resultId }, data: { status: 'CANCELLED' } });
      }
    }
    await writeLedger(tx, lines, { paymentId: payment.id, refundId: r.id });

    const title = payment.auctionId
      ? ((await tx.auction.findUnique({ where: { id: payment.auctionId }, include: { product: { select: { title: true } } } }))?.product.title ?? 'your payment')
      : 'your payment';
    await notify(payment.userId, 'REFUND_ISSUED', { title, amount: formatEtb(r.amount) }, { paymentId: payment.id, txRef: payment.txRef }, tx);
    if (actorId) await recordAudit({ actorId, action: 'refund.mark_processed', entity: 'refund', entityId: r.id, after: { providerRef }, req }, tx);
    return { userId: payment.userId, txRef: payment.txRef };
  });
  if (done) emitToUser(done.userId, 'payment:updated', { txRef: done.txRef });
  return done;
}

// ───────────────────────────── Admin and buyer actions ─────────────────────────────

export async function adminCreateRefund(paymentId, { amount, reason }, { actorId, req }) {
  const refund = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`SELECT id FROM payments WHERE id = ${BigInt(paymentId)} FOR UPDATE`;
    if (!rows.length) throw notFound('PAYMENT_NOT_FOUND', 'Payment not found');
    const payment = await tx.payment.findUnique({ where: { id: BigInt(paymentId) } });
    const pending = await openRefundTotal(tx, payment.id);
    const value = amount ?? refundableAmount(payment, pending);
    const r = await createRefundInTx(tx, { payment, kind: payment.purpose === 'BID_FEE' ? 'BID_FEE_REFUND' : 'SALE_REFUND', amount: value, reason, requestedById: actorId });
    await tx.refund.update({ where: { id: r.id }, data: { reviewedById: BigInt(actorId), reviewedAt: new Date() } });
    await recordAudit({ actorId, action: 'refund.create', entity: 'payment', entityId: payment.id, after: { amount: value, reason }, req }, tx);
    return r;
  });
  await scheduleRefund(refund.id);
  return refund;
}

/** A winner asks for their money back (item not as described, not delivered…). An admin decides. */
export async function requestRefundByBuyer(userId, txRef, reason, { req }) {
  const { disputeWindowDays } = await getSetting('orders.policy');
  return prisma.$transaction(async (tx) => {
    const p = await tx.payment.findUnique({ where: { txRef }, include: { result: true } });
    if (!p || p.userId !== BigInt(userId)) throw notFound('PAYMENT_NOT_FOUND', 'Payment not found');
    if (p.purpose !== 'WINNING_BID' || !p.result) throw badRequest('REFUND_NOT_ALLOWED', 'Bid fees are refunded automatically when an auction is cancelled or does not get enough bids');
    if (p.result.confirmedAt) throw conflict('ALREADY_CONFIRMED', 'You confirmed you received this item in good order. Contact support');
    if (!['PAID', 'FULFILLED'].includes(p.result.status)) throw conflict('REFUND_NOT_ALLOWED', 'This order cannot be refunded now');
    // The window runs from delivery (or from payment, while the item is not delivered yet).
    const from = p.result.fulfilledAt ?? p.verifiedAt ?? new Date(0);
    const deadline = from.getTime() + disputeWindowDays * 86_400_000;
    if (p.result.fulfilledAt && Date.now() > deadline) throw conflict('DISPUTE_WINDOW_CLOSED', `Refund requests are accepted within ${disputeWindowDays} days of delivery. Contact support`);
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${p.id} FOR UPDATE`;
    if (await tx.refund.count({ where: { paymentId: p.id, status: { in: OPEN } } })) throw conflict('REFUND_ALREADY_OPEN', 'A refund request is already open for this payment');
    const r = await createRefundInTx(tx, { payment: p, kind: 'SALE_REFUND', amount: refundableAmount(p), reason, requestedById: userId, status: 'REQUESTED' });
    await tx.auctionResult.update({ where: { id: p.result.id }, data: { status: 'DISPUTED' } });
    await recordAudit({ actorId: userId, action: 'refund.request', entity: 'payment', entityId: p.id, after: { reason }, req }, tx);
    return r;
  });
}

export async function reviewRefundRequest(refundId, { approve, reason }, { actorId, req }) {
  const r = await prisma.$transaction(async (tx) => {
    const refund = await lockRefund(tx, refundId);
    if (refund.status !== 'REQUESTED') throw conflict('REFUND_NOT_REQUESTED', `This refund is ${refund.status.toLowerCase()}`);
    const data = { reviewedById: BigInt(actorId), reviewedAt: new Date(), status: approve ? 'APPROVED' : 'REJECTED', ...(!approve && { failureReason: reason }) };
    await tx.refund.update({ where: { id: refund.id }, data });
    if (!approve && refund.payment.resultId) {
      const result = await tx.auctionResult.findUnique({ where: { id: refund.payment.resultId } });
      await tx.auctionResult.update({ where: { id: result.id }, data: { status: result.fulfilledAt ? 'FULFILLED' : 'PAID' } });
    }
    await recordAudit({ actorId, action: approve ? 'refund.approve' : 'refund.reject', entity: 'refund', entityId: refund.id, after: { reason }, req }, tx);
    return refund;
  });
  if (approve) await scheduleRefund(r.id);
  return prisma.refund.findUnique({ where: { id: r.id } });
}

export async function retryRefund(refundId, { actorId, req }) {
  await prisma.$transaction(async (tx) => {
    const r = await lockRefund(tx, refundId);
    if (r.status !== 'FAILED') throw conflict('REFUND_NOT_FAILED', 'Only failed refunds can be retried');
    // A new reference, because Chapa may have recorded the failed one.
    await tx.refund.update({ where: { id: r.id }, data: { status: 'APPROVED', attempts: 0, failureReason: null, providerStatus: null, reference: `LB-RF-${r.paymentId}-${newObjectId()}` } });
    await recordAudit({ actorId, action: 'refund.retry', entity: 'refund', entityId: r.id, req }, tx);
  });
  await scheduleRefund(refundId);
  return prisma.refund.findUnique({ where: { id: BigInt(refundId) } });
}

/** For refunds paid outside Chapa (manual mode) or confirmed on the Chapa dashboard. */
export async function markRefundProcessed(refundId, providerRef, ctx) {
  const r = await prisma.refund.findUnique({ where: { id: BigInt(refundId) } });
  if (!r) throw notFound('REFUND_NOT_FOUND', 'Refund not found');
  if (!['APPROVED', 'PROCESSING', 'FAILED'].includes(r.status)) throw conflict('REFUND_NOT_OPEN', `This refund is ${r.status.toLowerCase()}`);
  if (r.status === 'FAILED') await prisma.refund.update({ where: { id: r.id }, data: { status: 'APPROVED' } });
  await completeRefund(r.id, { providerRef, ...ctx });
  return prisma.refund.findUnique({ where: { id: r.id } });
}

/** Reconcile step: send approved refunds and check processing ones. */
export async function reconcileRefunds() {
  const [approved, processing] = await Promise.all([
    prisma.refund.findMany({ where: { status: 'APPROVED' }, select: { id: true }, take: 100 }),
    prisma.refund.findMany({ where: { status: 'PROCESSING', providerRef: { not: null } }, select: { id: true }, take: 100 }),
  ]);
  for (const { id } of approved) await processRefund(id).catch((err) => logger.error({ err, id: String(id) }, 'refund send failed'));
  for (const { id } of processing) await checkRefund(id).catch((err) => logger.error({ err, id: String(id) }, 'refund check failed'));
  return { sent: approved.length, checked: processing.length };
}
