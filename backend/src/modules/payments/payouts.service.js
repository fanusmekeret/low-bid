import { prisma } from '../../config/prisma.js';
import { chapa, chapaMessage } from '../../services/chapa/client.js';
import { newObjectId } from '../../services/storage/keys.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { formatEtb, minorToEtb, moneyDto } from '../../utils/money.js';
import { recordAudit } from '../audit/audit.service.js';
import { notify } from '../notifications/notifications.service.js';
import { getSetting } from '../settings/settings.service.js';
import { writeLedger } from './ledger.service.js';
import { ledger } from './payment.rules.js';
import { presentPayout } from './payment.presenter.js';

/** Created inside the payment settlement: what the seller will receive for this sale. */
export async function createPayoutInTx(tx, { result, payment, settlement, sellerId, paidAt }) {
  const { disputeWindowDays } = await getSetting('payout.policy');
  const seller = await tx.sellerProfile.findUnique({ where: { id: sellerId } });
  return tx.sellerPayout.create({
    data: {
      sellerId,
      resultId: result.id,
      paymentId: payment.id,
      reference: `LB-P-${result.id}-${newObjectId()}`,
      grossAmount: result.finalPrice,
      commission: settlement.commission,
      netAmount: settlement.sellerNet,
      method: seller.payoutMethod,
      status: 'PENDING',
      releaseAfter: new Date(paidAt.getTime() + disputeWindowDays * 86_400_000),
      bankCode: seller.payoutBankCode,
      accountName: seller.payoutAccountName,
      accountNo: seller.payoutAccountNo,
    },
  });
}

async function lockPayout(tx, id) {
  const rows = await tx.$queryRaw`SELECT id FROM seller_payouts WHERE id = ${BigInt(id)} FOR UPDATE`;
  if (!rows.length) throw notFound('PAYOUT_NOT_FOUND', 'Payout not found');
  return tx.sellerPayout.findUnique({ where: { id: BigInt(id) }, include: { seller: true } });
}

async function hasOpenRefund(db, paymentId) {
  if (!paymentId) return false;
  return (await db.refund.count({ where: { paymentId, status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] } } })) > 0;
}

async function finishPayout(tx, payout, { providerRef, actorId, req, action }) {
  await tx.sellerPayout.update({ where: { id: payout.id }, data: { status: 'PAID', paidAt: new Date(), providerRef, processedById: actorId ? BigInt(actorId) : null, failureReason: null } });
  await writeLedger(tx, ledger.payoutPaid(payout.netAmount), { payoutId: payout.id });
  await notify(payout.seller.userId, 'PAYOUT_SENT', { amount: formatEtb(payout.netAmount), reference: providerRef ?? payout.reference }, { payoutId: payout.id }, tx);
  if (actorId) await recordAudit({ actorId, action, entity: 'payout', entityId: payout.id, after: { providerRef, net: payout.netAmount }, req }, tx);
}

// ───────────────────────────── Banks ─────────────────────────────

let banksCache = null;
/** Chapa's list of banks and wallets (for seller payout settings). Cached for 6 hours. */
export async function listBanks() {
  if (banksCache && Date.now() - banksCache.at < 6 * 3_600_000) return banksCache.data;
  const res = await chapa.banks();
  if (res.httpStatus !== 200 || !Array.isArray(res.body?.data)) throw conflict('BANKS_UNAVAILABLE', `Could not load banks: ${chapaMessage(res)}`);
  const data = res.body.data.map((b) => ({ code: String(b.id), name: b.name, slug: b.slug ?? null, accountLength: b.acct_length ?? null, isMobileMoney: Boolean(b.is_mobilemoney) }));
  banksCache = { at: Date.now(), data };
  return data;
}

async function telebirrCode() {
  const banks = await listBanks();
  return banks.find((b) => /telebirr/i.test(`${b.slug} ${b.name}`))?.code ?? null;
}

// ───────────────────────────── Admin ─────────────────────────────

/** Sends a due payout through Chapa transfers (when payout.policy.method is CHAPA_TRANSFER). */
export async function sendPayout(payoutId, { actorId, req }) {
  const policy = await getSetting('payout.policy');
  if (policy.method !== 'CHAPA_TRANSFER') throw conflict('PAYOUT_MANUAL_MODE', 'Payouts are manual. Pay the seller, then record it with mark-paid');

  const claimed = await prisma.$transaction(async (tx) => {
    const p = await lockPayout(tx, payoutId);
    if (p.status !== 'PENDING') throw conflict('PAYOUT_NOT_PENDING', `This payout is ${p.status.toLowerCase().replace('_', ' ')}`);
    if (p.releaseAfter > new Date()) throw conflict('PAYOUT_NOT_DUE', 'The buyer can still dispute this sale', { releaseAfter: p.releaseAfter });
    if (await hasOpenRefund(tx, p.paymentId)) throw conflict('PAYOUT_REFUND_OPEN', 'A refund is open on this sale');
    if (!p.accountNo || !p.accountName) throw badRequest('PAYOUT_ACCOUNT_MISSING', 'The seller has no payout account');
    await tx.sellerPayout.update({ where: { id: p.id }, data: { status: 'PROCESSING', processedById: BigInt(actorId) } });
    await recordAudit({ actorId, action: 'payout.send', entity: 'payout', entityId: p.id, req }, tx);
    return p;
  });

  const bankCode = claimed.method === 'TELEBIRR' ? (claimed.bankCode ?? (await telebirrCode())) : claimed.bankCode;
  const accountNumber = claimed.method === 'TELEBIRR' ? claimed.accountNo.replace(/^\+251/, '0') : claimed.accountNo;
  let res;
  try {
    res = await chapa.transfer({
      account_name: claimed.accountName,
      account_number: accountNumber,
      amount: minorToEtb(claimed.netAmount),
      currency: 'ETB',
      reference: claimed.reference,
      bank_code: bankCode,
    });
  } catch (err) {
    await prisma.sellerPayout.update({ where: { id: claimed.id }, data: { status: 'PENDING', failureReason: err.message?.slice(0, 500) } });
    throw err;
  }
  const ok = res.httpStatus === 200 && String(res.body?.status).toLowerCase() === 'success';
  if (!ok) {
    // Most refusals are fixable (outside transfer hours, wrong account): back to PENDING with the reason.
    await prisma.sellerPayout.update({ where: { id: claimed.id }, data: { status: 'PENDING', failureReason: chapaMessage(res) } });
    throw conflict('PAYOUT_REFUSED', `Chapa refused the transfer: ${chapaMessage(res)}`);
  }
  await prisma.sellerPayout.update({ where: { id: claimed.id }, data: { providerRef: res.body?.data?.reference ?? res.body?.data ?? claimed.reference, failureReason: null } });
  return checkPayout(claimed.id).then(() => getPayoutAdmin(claimed.id));
}

/** Asks Chapa about a PROCESSING transfer. */
export async function checkPayout(payoutId) {
  const p = await prisma.sellerPayout.findUnique({ where: { id: BigInt(payoutId) } });
  if (!p || p.status !== 'PROCESSING') return { result: 'skipped' };
  const res = await chapa.verifyTransfer(p.reference);
  const status = String(res.body?.data?.status ?? '').toLowerCase();
  if (status === 'success') {
    await prisma.$transaction(async (tx) => {
      const locked = await lockPayout(tx, p.id);
      if (locked.status !== 'PROCESSING') return;
      await finishPayout(tx, locked, { providerRef: res.body.data.chapa_reference ?? res.body.data.reference ?? p.reference });
    });
    return { result: 'paid' };
  }
  if (['failed', 'cancelled', 'reversed'].includes(status)) {
    await prisma.sellerPayout.update({ where: { id: p.id }, data: { status: 'FAILED', failureReason: `Chapa transfer ${status}` } });
    return { result: 'failed' };
  }
  return { result: 'pending', status };
}

/** Records a payout made outside Chapa (bank transfer by finance). */
export async function markPayoutPaid(payoutId, reference, { actorId, req }) {
  await prisma.$transaction(async (tx) => {
    const p = await lockPayout(tx, payoutId);
    if (!['PENDING', 'FAILED', 'PROCESSING'].includes(p.status)) throw conflict('PAYOUT_NOT_OPEN', `This payout is ${p.status.toLowerCase().replace('_', ' ')}`);
    if (await hasOpenRefund(tx, p.paymentId)) throw conflict('PAYOUT_REFUND_OPEN', 'A refund is open on this sale');
    await finishPayout(tx, p, { providerRef: reference, actorId, req, action: 'payout.mark_paid' });
  });
  return getPayoutAdmin(payoutId);
}

export async function setPayoutHold(payoutId, { hold, reason }, { actorId, req }) {
  await prisma.$transaction(async (tx) => {
    const p = await lockPayout(tx, payoutId);
    if (hold && p.status !== 'PENDING') throw conflict('PAYOUT_NOT_PENDING', 'Only pending payouts can be held');
    if (!hold && p.status !== 'ON_HOLD') throw conflict('PAYOUT_NOT_ON_HOLD', 'This payout is not on hold');
    if (!hold && (await hasOpenRefund(tx, p.paymentId))) throw conflict('PAYOUT_REFUND_OPEN', 'A refund is open on this sale');
    await tx.sellerPayout.update({ where: { id: p.id }, data: { status: hold ? 'ON_HOLD' : 'PENDING', notes: hold ? reason : null } });
    await recordAudit({ actorId, action: hold ? 'payout.hold' : 'payout.release', entity: 'payout', entityId: p.id, after: { reason }, req }, tx);
  });
  return getPayoutAdmin(payoutId);
}

export async function getPayoutAdmin(id) {
  const p = await prisma.sellerPayout.findUnique({ where: { id: BigInt(id) }, include: { seller: { select: { businessName: true, id: true } } } });
  if (!p) throw notFound('PAYOUT_NOT_FOUND', 'Payout not found');
  return { ...presentPayout(p, { full: true }), seller: { id: p.seller.id.toString(), businessName: p.seller.businessName }, notes: p.notes };
}

export async function listPayoutsAdmin({ status, due, page, pageSize }) {
  const where = { ...(status && { status }), ...(due && { status: 'PENDING', releaseAfter: { lte: new Date() } }) };
  const [total, rows] = await Promise.all([
    prisma.sellerPayout.count({ where }),
    prisma.sellerPayout.findMany({ where, orderBy: { releaseAfter: 'asc' }, skip: (page - 1) * pageSize, take: pageSize, include: { seller: { select: { businessName: true, id: true } } } }),
  ]);
  return {
    data: rows.map((p) => ({ ...presentPayout(p, { full: true }), seller: { id: p.seller.id.toString(), businessName: p.seller.businessName }, notes: p.notes })),
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

// ───────────────────────────── Seller ─────────────────────────────

export async function sellerEarnings(sellerId) {
  const sums = await prisma.sellerPayout.groupBy({ by: ['status'], where: { sellerId }, _sum: { grossAmount: true, commission: true, netAmount: true }, _count: true });
  const by = Object.fromEntries(sums.map((s) => [s.status, s]));
  const sum = (statuses, field) => statuses.reduce((t, st) => t + (by[st]?._sum[field] ?? 0n), 0n);
  const all = ['PENDING', 'ON_HOLD', 'PROCESSING', 'PAID', 'FAILED'];
  return {
    salesCount: all.reduce((t, st) => t + (by[st]?._count ?? 0), 0),
    grossSales: moneyDto(sum(all, 'grossAmount')),
    commission: moneyDto(sum(all, 'commission')),
    netEarnings: moneyDto(sum(all, 'netAmount')),
    paidOut: moneyDto(sum(['PAID'], 'netAmount')),
    pending: moneyDto(sum(['PENDING', 'PROCESSING', 'FAILED'], 'netAmount')),
    onHold: moneyDto(sum(['ON_HOLD'], 'netAmount')),
  };
}

export async function sellerPayouts(sellerId, { status, page, pageSize }) {
  const where = { sellerId, ...(status && { status }) };
  const [total, rows] = await Promise.all([
    prisma.sellerPayout.count({ where }),
    prisma.sellerPayout.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return { data: rows.map((p) => presentPayout(p)), meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}

export async function reconcilePayouts() {
  const processing = await prisma.sellerPayout.findMany({ where: { status: 'PROCESSING' }, select: { id: true }, take: 100 });
  for (const { id } of processing) await checkPayout(id).catch((err) => logger.error({ err, id: String(id) }, 'payout check failed'));
  return { checked: processing.length };
}
