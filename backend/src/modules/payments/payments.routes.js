import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { etbToMinor, moneyDto } from '../../utils/money.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { requireApprovedSeller } from '../sellers/sellers.service.js';
import { ledgerBalances } from './ledger.service.js';
import { presentPayment, presentRefund } from './payment.presenter.js';
import { TX_REF_PATTERN } from './payment.rules.js';
import * as payments from './payments.service.js';
import * as payouts from './payouts.service.js';
import * as refunds from './refunds.service.js';
import { confirmReceived } from './results.service.js';
import { handleChapaWebhook } from './webhooks.service.js';

const P = PERMISSIONS;
const ctx = (req) => ({ actorId: req.auth.userId, req });
const txRefParam = z.object({ txRef: z.string().regex(TX_REF_PATTERN) });
const idParam = z.object({ id: z.coerce.bigint().positive() });
const auctionBody = z.object({ auctionId: z.coerce.bigint().positive() });
const reasonBody = z.object({ reason: z.string().trim().min(3).max(500) });
const page = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) };

// ───────────── /api/v1/payments ─────────────
export const paymentsRouter = Router();

// Chapa → us. No user auth; the signature is checked and every action re-verifies with Chapa.
paymentsRouter.post('/chapa/webhook', async (req, res) => {
  const out = await handleChapaWebhook({ headers: req.headers, rawBody: req.rawBody, body: req.body });
  res.status(out.httpStatus).json(out.body);
});

// Chapa calls callback_url after a payment; query carries trx_ref (or tx_ref), ref_id and status.
paymentsRouter.get('/chapa/callback', async (req, res) => {
  const txRef = String(req.query.trx_ref ?? req.query.tx_ref ?? req.body?.trx_ref ?? '');
  if (!TX_REF_PATTERN.test(txRef)) return res.status(400).json({ error: { code: 'INVALID_TX_REF', message: 'Unknown payment reference' } });
  const out = await payments.verifyAndSettle(txRef, { source: 'callback' });
  return res.json({ data: { status: out.status } });
});

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The buyer's browser lands here after Chapa's page. The app watches for this URL and closes
// the in-app browser; a plain browser shows a short message and a button back to the app.
paymentsRouter.get('/chapa/return', async (req, res) => {
  const txRef = String(req.query.tx_ref ?? req.query.trx_ref ?? '');
  let status = 'UNKNOWN';
  if (TX_REF_PATTERN.test(txRef)) status = (await payments.verifyAndSettle(txRef, { source: 'return' }).catch(() => ({ status: 'PENDING' }))).status;
  const copy = {
    PAID: ['Payment confirmed', 'Thank you. Your payment is confirmed. ክፍያዎ ተረጋግጧል።'],
    FAILED: ['Payment not completed', 'The payment did not go through. You can try again in the app. ክፍያው አልተጠናቀቀም።'],
  }[status] ?? ['Confirming your payment', 'We are confirming your payment with Chapa. This usually takes a few seconds. ክፍያዎን እያረጋገጥን ነው።'];
  const appLink = `${env.APP_DEEP_LINK}?tx_ref=${encodeURIComponent(txRef)}&status=${encodeURIComponent(status)}`;
  res.set({ 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'", 'Cache-Control': 'no-store' });
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(copy[0])}</title>
<style>body{font-family:system-ui,sans-serif;background:#FAF7F2;color:#14181C;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;text-align:center}
.c{max-width:420px}.b{color:#0F4C5C;font-weight:800;letter-spacing:.05em}a{display:inline-block;margin-top:20px;background:#0F4C5C;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600}</style></head>
<body><div class="c"><div class="b">LOW BID</div><h1>${esc(copy[0])}</h1><p>${esc(copy[1])}</p><a href="${esc(appLink)}">Back to LOW BID</a></div></body></html>`);
});

// Everything below needs a signed-in user.
paymentsRouter.post('/checkout', authenticate, requirePermission(P.PAYMENT_MAKE), validate({ body: auctionBody }), async (req, res) => {
  res.status(201).json({ data: await payments.startWinnerCheckout(req.auth.userId, req.valid.body.auctionId) });
});

paymentsRouter.get('/', authenticate, validate({ query: z.object(page) }), async (req, res) => {
  res.json(await payments.paymentHistory(req.auth.userId, req.valid.query));
});

paymentsRouter.get('/banks', authenticate, async (_req, res) => {
  res.json({ data: await payouts.listBanks() });
});

paymentsRouter.get('/:txRef', authenticate, validate({ params: txRefParam }), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ data: await payments.paymentStatus(req.auth.userId, req.valid.params.txRef) });
});

paymentsRouter.get('/:txRef/receipt', authenticate, validate({ params: txRefParam, query: z.object({ format: z.enum(['json', 'html']).default('json') }) }), async (req, res) => {
  const r = await payments.receipt(req.auth.userId, req.valid.params.txRef, { isAdmin: req.auth.permissions.has(P.PAYMENT_VIEW) });
  if (req.valid.query.format === 'html') {
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    return res.type('html').send(payments.receiptHtml(r));
  }
  return res.json({ data: r });
});

paymentsRouter.post('/:txRef/refund-request', authenticate, validate({ params: txRefParam, body: reasonBody }), async (req, res) => {
  const r = await refunds.requestRefundByBuyer(req.auth.userId, req.valid.params.txRef, req.valid.body.reason, { req });
  res.status(201).json({ data: presentRefund(r) });
});

// ───────────── /api/v1/me/auctions/:id/confirm-received ─────────────
export const myPaymentsRouter = Router();
myPaymentsRouter.post('/auctions/:id/confirm-received', authenticate, validate({ params: idParam }), async (req, res) => {
  res.json({ data: await confirmReceived(req.auth.userId, req.valid.params.id, { req }) });
});

// ───────────── /api/v1/seller/earnings and /seller/payouts ─────────────
// Middleware is per route (not router.use): this router shares the /seller prefix with the
// application routes, which must stay reachable for sellers who are not approved yet.
const approvedSeller = [authenticate, requirePermission(P.SELLER_DASHBOARD), async (req, _res, next) => {
  req.seller = await requireApprovedSeller(req.auth.userId);
  next();
}];
export const sellerMoneyRouter = Router();
sellerMoneyRouter.get('/earnings', ...approvedSeller, async (req, res) => {
  res.json({ data: await payouts.sellerEarnings(req.seller.id) });
});
sellerMoneyRouter.get('/payouts', ...approvedSeller, validate({ query: z.object({ status: z.enum(['PENDING', 'ON_HOLD', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED']).optional(), ...page }) }), async (req, res) => {
  res.json(await payouts.sellerPayouts(req.seller.id, req.valid.query));
});

// ───────────── /api/v1/admin/payments, /refunds, /payouts, /ledger ─────────────
export const adminPaymentsRouter = Router();
adminPaymentsRouter.use(authenticate, requirePermission(P.ADMIN_ACCESS));

adminPaymentsRouter.get('/payments', requirePermission(P.PAYMENT_VIEW), validate({
  query: z.object({
    status: z.enum(['INITIATED', 'PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED']).optional(),
    purpose: z.enum(['WINNING_BID', 'BID_FEE']).optional(),
    needsReview: z.enum(['true']).optional(),
    q: z.string().trim().min(1).max(64).optional(),
    ...page,
  }),
}), async (req, res) => {
  const { status, purpose, needsReview, q, page: pg, pageSize } = req.valid.query;
  const where = {
    ...(status && { status }),
    ...(purpose && { purpose }),
    ...(needsReview && { failureReason: { startsWith: 'NEEDS_REVIEW' } }),
    ...(q && { OR: [{ txRef: { contains: q } }, { providerRef: { contains: q } }, { receiptNo: { contains: q } }] }),
  };
  const [total, rows] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (pg - 1) * pageSize, take: pageSize }),
  ]);
  res.json({ data: rows.map((p) => presentPayment(p, { admin: true })), meta: { page: pg, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
});

adminPaymentsRouter.get('/payments/:id', requirePermission(P.PAYMENT_VIEW), validate({ params: idParam }), async (req, res) => {
  const p = await prisma.payment.findUnique({
    where: { id: req.valid.params.id },
    include: { webhooks: { orderBy: { receivedAt: 'desc' }, take: 20 }, refunds: { orderBy: { createdAt: 'desc' } }, transactions: { orderBy: { id: 'asc' } }, bid: { select: { id: true, status: true, amount: true } }, user: { select: { id: true, firstName: true, lastName: true, phone: true } } },
  });
  if (!p) return res.status(404).json({ error: { code: 'PAYMENT_NOT_FOUND', message: 'Payment not found' } });
  return res.json({
    data: {
      ...presentPayment(p, { admin: true }),
      user: { id: p.user.id.toString(), name: `${p.user.firstName} ${p.user.lastName}`, phone: p.user.phone },
      verifyPayload: p.verifyPayload,
      bid: p.bid ? { id: p.bid.id.toString(), status: p.bid.status, amount: moneyDto(p.bid.amount) } : null,
      refunds: p.refunds.map(presentRefund),
      webhooks: p.webhooks.map((w) => ({ id: w.id.toString(), eventKey: w.eventKey, signatureValid: w.signatureValid, receivedAt: w.receivedAt, processedAt: w.processedAt, processError: w.processError })),
      ledger: p.transactions.map((t) => ({ groupId: t.groupId, account: t.account, direction: t.direction, amount: moneyDto(t.amount), memo: t.memo, createdAt: t.createdAt })),
    },
  });
});

adminPaymentsRouter.post('/payments/:id/reconcile', requirePermission(P.PAYMENT_RECONCILE), validate({ params: idParam }), async (req, res) => {
  const p = await prisma.payment.findUnique({ where: { id: req.valid.params.id } });
  if (!p) return res.status(404).json({ error: { code: 'PAYMENT_NOT_FOUND', message: 'Payment not found' } });
  const out = await payments.verifyAndSettle(p.txRef, { source: `admin:${req.auth.userId}` });
  return res.json({ data: out });
});

adminPaymentsRouter.post('/payments/:id/refunds', requirePermission(P.REFUND_MANAGE), validate({
  params: idParam,
  body: z.object({ amount: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).optional(), reason: z.string().trim().min(3).max(500) }),
}), async (req, res) => {
  const r = await refunds.adminCreateRefund(req.valid.params.id, { amount: req.valid.body.amount ? etbToMinor(req.valid.body.amount) : undefined, reason: req.valid.body.reason }, ctx(req));
  res.status(201).json({ data: presentRefund(r) });
});

adminPaymentsRouter.get('/refunds', requirePermission(P.REFUND_MANAGE), validate({
  query: z.object({ status: z.enum(['REQUESTED', 'APPROVED', 'PROCESSING', 'PROCESSED', 'REJECTED', 'FAILED']).optional(), kind: z.enum(['BID_FEE_REFUND', 'SALE_REFUND', 'LATE_PAYMENT']).optional(), ...page }),
}), async (req, res) => {
  const { status, kind, page: pg, pageSize } = req.valid.query;
  const where = { ...(status && { status }), ...(kind && { kind }) };
  const [total, rows] = await Promise.all([
    prisma.refund.count({ where }),
    prisma.refund.findMany({ where, orderBy: { createdAt: status === 'REQUESTED' ? 'asc' : 'desc' }, skip: (pg - 1) * pageSize, take: pageSize }),
  ]);
  res.json({ data: rows.map(presentRefund), meta: { page: pg, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
});

adminPaymentsRouter.post('/refunds/:id/approve', requirePermission(P.REFUND_MANAGE), validate({ params: idParam }), async (req, res) => {
  res.json({ data: presentRefund(await refunds.reviewRefundRequest(req.valid.params.id, { approve: true }, ctx(req))) });
});
adminPaymentsRouter.post('/refunds/:id/reject', requirePermission(P.REFUND_MANAGE), validate({ params: idParam, body: reasonBody }), async (req, res) => {
  res.json({ data: presentRefund(await refunds.reviewRefundRequest(req.valid.params.id, { approve: false, reason: req.valid.body.reason }, ctx(req))) });
});
adminPaymentsRouter.post('/refunds/:id/retry', requirePermission(P.REFUND_MANAGE), validate({ params: idParam }), async (req, res) => {
  res.json({ data: presentRefund(await refunds.retryRefund(req.valid.params.id, ctx(req))) });
});
adminPaymentsRouter.post('/refunds/:id/mark-processed', requirePermission(P.REFUND_MANAGE), validate({ params: idParam, body: z.object({ providerRef: z.string().trim().min(3).max(100) }) }), async (req, res) => {
  res.json({ data: presentRefund(await refunds.markRefundProcessed(req.valid.params.id, req.valid.body.providerRef, ctx(req))) });
});

adminPaymentsRouter.get('/payouts', requirePermission(P.PAYOUT_MANAGE), validate({
  query: z.object({ status: z.enum(['PENDING', 'ON_HOLD', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED']).optional(), due: z.enum(['true']).optional(), ...page }),
}), async (req, res) => {
  res.json(await payouts.listPayoutsAdmin({ ...req.valid.query, due: req.valid.query.due === 'true' }));
});
adminPaymentsRouter.post('/payouts/:id/send', requirePermission(P.PAYOUT_MANAGE), validate({ params: idParam }), async (req, res) => {
  res.json({ data: await payouts.sendPayout(req.valid.params.id, ctx(req)) });
});
adminPaymentsRouter.post('/payouts/:id/mark-paid', requirePermission(P.PAYOUT_MANAGE), validate({ params: idParam, body: z.object({ reference: z.string().trim().min(3).max(100) }) }), async (req, res) => {
  res.json({ data: await payouts.markPayoutPaid(req.valid.params.id, req.valid.body.reference, ctx(req)) });
});
adminPaymentsRouter.post('/payouts/:id/hold', requirePermission(P.PAYOUT_MANAGE), validate({ params: idParam, body: reasonBody }), async (req, res) => {
  res.json({ data: await payouts.setPayoutHold(req.valid.params.id, { hold: true, reason: req.valid.body.reason }, ctx(req)) });
});
adminPaymentsRouter.post('/payouts/:id/release', requirePermission(P.PAYOUT_MANAGE), validate({ params: idParam }), async (req, res) => {
  res.json({ data: await payouts.setPayoutHold(req.valid.params.id, { hold: false }, ctx(req)) });
});

adminPaymentsRouter.get('/ledger/balances', requirePermission(P.REPORT_VIEW), async (_req, res) => {
  const { balances, balanced } = await ledgerBalances();
  res.json({ data: { balanced, balances: Object.fromEntries(Object.entries(balances).map(([k, v]) => [k, moneyDto(v)])) } });
});
