import { createHmac, timingSafeEqual } from 'node:crypto';
import { etbToMinor } from '../../utils/money.js';

// Pure payment rules: no database, no network. All money is BigInt santim.

// ───────────────────────────── Settlement ─────────────────────────────

/**
 * What the winner pays: their winning bid plus the optional buyer premium (0 by default).
 * LOW BID is the only seller, so all of it is platform revenue.
 * @param {{ finalPrice: bigint, buyerPremium: bigint }} x
 */
export function computeSettlement({ finalPrice, buyerPremium }) {
  const total = finalPrice + buyerPremium;
  return { total, cashDue: total };
}

// ───────────────────────────── Ledger ─────────────────────────────
// Each money movement is a group of lines whose debits equal its credits.
// Moving X from account A to account B is CREDIT A, DEBIT B.

const move = (from, to, amount, memo) =>
  amount > 0n ? [{ account: from, direction: 'CREDIT', amount, memo }, { account: to, direction: 'DEBIT', amount, memo }] : [];

export const ledger = {
  bidFeePaid: (fee) => move('EXTERNAL', 'PLATFORM_REVENUE', fee, 'Bid fee received'),
  bidFeeRefunded: (fee) => move('PLATFORM_REVENUE', 'EXTERNAL', fee, 'Bid fee refunded'),
  /** Winner paid: through escrow (so a late payment can be told apart) into platform revenue. */
  salePaid: (s) => [
    ...move('EXTERNAL', 'ESCROW', s.cashDue, 'Winning bid payment'),
    ...move('ESCROW', 'PLATFORM_REVENUE', s.total, 'Winning bid to platform'),
  ],
  providerFee: (fee) => move('PLATFORM_REVENUE', 'PROVIDER_FEES', fee, 'Chapa processing fee'),
  /** Money that arrived but cannot be used (the offer had ended): held in escrow until refunded. */
  unappliedReceived: (amount) => move('EXTERNAL', 'ESCROW', amount, 'Payment received after the offer ended'),
  unappliedRefunded: (amount) => move('ESCROW', 'EXTERNAL', amount, 'Refund of unapplied payment'),
  saleRefunded: (amount) => move('PLATFORM_REVENUE', 'EXTERNAL', amount, 'Sale refund'),
};

export function isBalanced(lines) {
  let debit = 0n;
  let credit = 0n;
  for (const l of lines) {
    if (l.amount <= 0n) return false;
    if (l.direction === 'DEBIT') debit += l.amount;
    else if (l.direction === 'CREDIT') credit += l.amount;
    else return false;
  }
  return debit === credit;
}

// ───────────────────────────── Refundable amount ─────────────────────────────

/** @param {{ status: string, amount: bigint, refundedAmount: bigint }} payment @param {bigint} pendingRefunds */
export function refundableAmount(payment, pendingRefunds = 0n) {
  if (!['PAID', 'PARTIALLY_REFUNDED'].includes(payment.status)) return 0n;
  const left = payment.amount - payment.refundedAmount - pendingRefunds;
  return left > 0n ? left : 0n;
}

// ───────────────────────────── Chapa helpers ─────────────────────────────

/** tx_ref sent to Chapa: LB-F-42-<id> (bid fee) or LB-W-42-<id> (winning bid). Letters, digits and dashes. */
export const buildTxRef = (purpose, auctionId, uniqueId) => `LB-${purpose === 'BID_FEE' ? 'F' : 'W'}-${auctionId}-${uniqueId}`;

/** Matches our own tx_refs (used to ignore junk on the public return page). */
export const TX_REF_PATTERN = /^LB-[FW]-\d+-[a-z0-9]+$/;

/** LB-R-20261109-000123 */
export function receiptNumber(paymentId, paidAt) {
  const d = paidAt.toISOString().slice(0, 10).replaceAll('-', '');
  return `LB-R-${d}-${String(paymentId).padStart(6, '0')}`;
}

/** Chapa wants 10-digit local numbers: +251912345678 → 0912345678. */
export const chapaPhone = (e164) => (/^\+251[79]\d{8}$/.test(e164 ?? '') ? `0${e164.slice(4)}` : undefined);

/** Chapa limits customization text to letters, numbers, spaces, dots, dashes and underscores. */
export const chapaText = (s, max) => s.replace(/[^A-Za-z0-9 ._-]/g, '').replace(/\s+/g, ' ').trim().slice(0, max).trim();

/**
 * Turns Chapa's verify response into a decision. Nothing is marked paid unless Chapa says
 * "success" AND the reference, currency and exact amount match what we asked for.
 *
 * @param {{ txRef: string, amount: bigint, currency: string }} payment our record
 * @param {{ httpStatus: number, body: any }} res
 * @param {{ expectLive: boolean }} opts
 * @returns {{ state: 'success'|'failed'|'pending'|'not_found'|'mismatch'|'error', reason?: string,
 *             providerRef?: string, fee?: bigint, method?: string }}
 */
export function classifyVerification(payment, { httpStatus, body }, { expectLive }) {
  if (httpStatus === 404) {
    return /not paid yet/i.test(body?.message ?? '') ? { state: 'pending', reason: 'NOT_PAID_YET' } : { state: 'not_found', reason: 'NOT_FOUND' };
  }
  if (httpStatus !== 200 || !body?.data) return { state: 'error', reason: `HTTP_${httpStatus}` };

  const d = body.data;
  const status = String(d.status ?? '').toLowerCase();
  if (status === 'pending') return { state: 'pending' };
  if (['failed', 'cancelled', 'canceled', 'reversed'].includes(status)) return { state: 'failed', reason: `CHAPA_${status.toUpperCase()}` };
  if (status !== 'success') return { state: 'error', reason: `UNKNOWN_STATUS_${status || 'EMPTY'}` };

  if (d.tx_ref !== payment.txRef) return { state: 'mismatch', reason: 'TX_REF_MISMATCH' };
  if (String(d.currency).toUpperCase() !== payment.currency) return { state: 'mismatch', reason: 'CURRENCY_MISMATCH' };
  let paid;
  try {
    paid = etbToMinor(normalizeAmount(d.amount));
  } catch {
    return { state: 'mismatch', reason: 'AMOUNT_UNREADABLE' };
  }
  if (paid !== payment.amount) return { state: 'mismatch', reason: 'AMOUNT_MISMATCH' };
  if (expectLive && d.mode && d.mode !== 'live') return { state: 'mismatch', reason: 'TEST_MODE_PAYMENT' };

  let fee = 0n;
  try { fee = d.charge === undefined || d.charge === null ? 0n : etbToMinor(normalizeAmount(d.charge)); } catch { fee = 0n; }
  return { state: 'success', providerRef: d.reference ?? undefined, fee, method: d.method ?? d.payment_method ?? undefined };
}

/** Chapa sends numbers (100, 3.5) or strings ("400.00"); never use float maths on them. */
function normalizeAmount(v) {
  const text = typeof v === 'number' ? v.toFixed(2) : String(v).trim();
  return text.replace(/(\.\d{2})\d*$/, '$1');
}

// ───────────────────────────── Webhook signatures ─────────────────────────────

const hmacHex = (secret, data) => createHmac('sha256', secret).update(data).digest('hex');
function equalHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !/^[0-9a-f]+$/i.test(a)) return false;
  return timingSafeEqual(Buffer.from(a.toLowerCase(), 'hex'), Buffer.from(b.toLowerCase(), 'hex'));
}

/**
 * Chapa's docs describe `x-chapa-signature` as HMAC-SHA256(payload, secret) and
 * `chapa-signature` as HMAC-SHA256(secret, secret). Their sample signs JSON.stringify(body),
 * so both the raw bytes and the re-serialised body are accepted.
 * A valid signature only triggers a check: payments are settled solely from Chapa's verify API.
 * @returns {'payload'|'secret'|null} which check passed
 */
export function verifyWebhookSignature({ headers, rawBody, parsedBody, secret }) {
  if (!secret) return null;
  const payloadSig = headers['x-chapa-signature'];
  if (payloadSig) {
    const candidates = [rawBody && hmacHex(secret, rawBody), parsedBody && hmacHex(secret, JSON.stringify(parsedBody))].filter(Boolean);
    if (candidates.some((c) => equalHex(c, payloadSig))) return 'payload';
  }
  const secretSig = headers['chapa-signature'];
  if (secretSig && equalHex(hmacHex(secret, secret), secretSig)) return 'secret';
  return null;
}
