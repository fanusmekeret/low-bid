import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, it } from 'bun:test';
import { startFakeChapa } from './fake-chapa.js';
import { hasTestDb } from './helpers.js';

const ETB = (n) => BigInt(Math.round(n * 100));

describe.skipIf(!hasTestDb)('Chapa payments: bid fees, winner payment, refunds and payouts (MySQL + fake Chapa)', () => {
  let fake;
  let ctx;
  let request;
  let prisma;
  let lifecycle;
  let refunds;
  let results;
  let settings;
  let signAccessToken;
  let DEMO_SPECS;
  let admin;
  let seller;
  let bidders;
  let seq = 0;

  const api = () => request(ctx.app);
  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const bid = (auctionId, token, amount) => api().post(`/api/v1/auctions/${auctionId}/bids`).set(auth(token)).send({ amount: String(amount), idempotencyKey: randomUUID() });
  const sendWebhook = ({ raw, headers }) => api().post('/api/v1/payments/chapa/webhook').set(headers).send(raw);

  async function makeUsers(n, roles = ['buyer', 'bidder']) {
    const roleRows = await prisma.role.findMany({ where: { code: { in: roles } } });
    const out = [];
    for (let i = 0; i < n; i += 1) {
      seq += 1;
      const user = await prisma.user.create({
        data: {
          phone: `+2519130${String(seq).padStart(5, '0')}`, firstName: `Payer${seq}`, lastName: 'Test', passwordHash: 'x', email: `payer${seq}@example.com`,
          phoneVerifiedAt: new Date(), roles: { create: roleRows.map((r) => ({ roleId: r.id })) },
        },
      });
      out.push({ user, token: signAccessToken(user, roles).token });
    }
    return out;
  }

  async function auction(over = {}) {
    const now = Date.now();
    const endsAt = over.endsAt ?? new Date(now + 3_600_000);
    return prisma.auction.create({
      data: {
        productId: seller.product.id, status: 'LIVE', sellerPrice: ETB(1000), bidFee: ETB(10), minBid: 1n, maxBid: ETB(1000), bidStep: 1n,
        startsAt: new Date(now - 3_600_000), endsAt, ...over,
      },
    });
  }

  /** Places a bid and pays its fee through the fake Chapa. Returns the fee's tx_ref. */
  async function paidBid(auctionId, who, amount) {
    const res = await bid(auctionId, who.token, amount);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    fake.pay(res.body.data.payment.txRef);
    assert.equal((await sendWebhook(fake.webhook(res.body.data.payment.txRef))).status, 200);
    return res.body.data.payment.txRef;
  }

  async function closeNow(auctionId) {
    await prisma.auction.update({ where: { id: auctionId }, data: { endsAt: new Date(Date.now() - 10 * 60_000) } });
    return lifecycle.closeAuction(auctionId);
  }

  async function assertLedgerBalanced() {
    const res = await api().get('/api/v1/admin/ledger/balances').set(auth(admin.token));
    assert.equal(res.body.data.balanced, true, JSON.stringify(res.body.data));
    return res.body.data.balances;
  }

  beforeAll(async () => {
    fake = await startFakeChapa();
    process.env.CHAPA_BASE_URL = fake.baseUrl;
    process.env.CHAPA_SECRET_KEY = fake.secretKey;
    process.env.CHAPA_WEBHOOK_SECRET = fake.webhookSecret;
    process.env.CHAPA_EXPECT_LIVE = 'false';
    ({ default: request } = await import('supertest'));
    const { setup } = await import('./helpers.js');
    ctx = await setup();
    prisma = ctx.prisma;
    await ctx.reset();
    lifecycle = await import('../../src/modules/auctions/lifecycle.service.js');
    refunds = await import('../../src/modules/payments/refunds.service.js');
    results = await import('../../src/modules/payments/results.service.js');
    settings = await import('../../src/modules/settings/settings.service.js');
    ({ signAccessToken } = await import('../../src/modules/auth/tokens.js'));
    ({ DEMO_SPECS } = await import('../../src/db/demo/demo-specs.js'));

    [admin] = await makeUsers(1, ['buyer', 'bidder', 'super_admin']);
    const [s] = await makeUsers(1, ['buyer', 'bidder', 'seller']);
    const profile = await prisma.sellerProfile.create({
      data: { userId: s.user.id, businessName: 'Bole Mobile', city: 'Addis Ababa', status: 'APPROVED', payoutMethod: 'BANK_TRANSFER', payoutBankCode: '946', payoutAccountName: 'Bole Mobile PLC', payoutAccountNo: '1000123456789' },
    });
    const category = await prisma.category.findUnique({ where: { slug: 'vehicles' } });
    const product = await prisma.product.create({
      data: { sellerId: profile.id, categoryId: category.id, title: 'Toyota Vitz 2014', description: 'Well kept, one owner, full service history.', condition: 'USED_GOOD', location: 'Addis Ababa', status: 'APPROVED', attributes: DEMO_SPECS['iphone-13'] },
    });
    seller = { ...s, profile, product };
    bidders = await makeUsers(4);
  });

  afterAll(async () => {
    await ctx?.close();
    await fake?.close();
  });

  // ─────────────── Bid fees ───────────────

  describe('bid fees', () => {
    let a;
    let feeRef;
    beforeAll(async () => { a = await auction(); });

    it('starts a Chapa checkout for the fee with valid fields', async () => {
      const res = await bid(a.id, bidders[0].token, '1.50');
      assert.equal(res.status, 201, JSON.stringify(res.body));
      feeRef = res.body.data.payment.txRef;
      assert.equal(res.body.data.payment.amount.etb, '10.00');
      const init = fake.calls.find((c) => c.path === '/v1/transaction/initialize' && c.body.tx_ref === feeRef);
      assert.equal(init.body.amount, '10.00');
      assert.equal(init.body.currency, 'ETB');
      assert.equal(init.body.phone_number.length, 10);
      assert.ok(init.body.callback_url.endsWith('/api/v1/payments/chapa/callback'));
    });

    it('stays pending until Chapa confirms', async () => {
      const res = await api().get(`/api/v1/payments/${feeRef}`).set(auth(bidders[0].token));
      assert.equal(res.body.data.status, 'PENDING');
    });

    it('ignores webhooks with a bad signature', async () => {
      fake.pay(feeRef);
      const bad = fake.webhook(feeRef, { sign: false });
      bad.headers['x-chapa-signature'] = 'a'.repeat(64);
      assert.equal((await sendWebhook(bad)).status, 401);
      assert.equal((await prisma.payment.findUnique({ where: { txRef: feeRef } })).status, 'PENDING');
    });

    it('settles from a signed webhook, once, and books the fee as revenue', async () => {
      const hook = fake.webhook(feeRef);
      assert.equal((await sendWebhook(hook)).status, 200);
      assert.equal((await sendWebhook(hook)).body.duplicate, true);
      const p = await prisma.payment.findUnique({ where: { txRef: feeRef }, include: { bid: true } });
      assert.equal(p.status, 'PAID');
      assert.match(p.receiptNo, /^LB-R-\d{8}-\d{6}$/);
      assert.equal(p.bid.status, 'ACTIVE');
      const receipt = await api().get(`/api/v1/payments/${feeRef}/receipt`).set(auth(bidders[0].token));
      assert.deepEqual(receipt.body.data.lines.map((l) => l.label), ['Bid fee']);
      await assertLedgerBalanced();
    });

    it('never accepts a fee for the wrong amount', async () => {
      const res = await bid(a.id, bidders[1].token, '2');
      fake.pay(res.body.data.payment.txRef, { amount: 5 });
      await sendWebhook(fake.webhook(res.body.data.payment.txRef));
      const p = await prisma.payment.findUnique({ where: { txRef: res.body.data.payment.txRef }, include: { bid: true } });
      assert.equal(p.status, 'FAILED');
      assert.match(p.failureReason, /NEEDS_REVIEW: AMOUNT_MISMATCH/);
      assert.equal(p.bid.status, 'PENDING_PAYMENT', 'never counted');
    });
  });

  // ─────────────── Winner payment and payout ───────────────

  describe('winner payment and payout', () => {
    let a;
    let winnerRef;
    beforeAll(async () => {
      a = await auction();
      await paidBid(a.id, bidders[0], '3');
      await paidBid(a.id, bidders[1], '3');
      await paidBid(a.id, bidders[1], '7.25'); // lowest unique
      assert.equal((await closeNow(a.id)).outcome, 'SOLD');
    });

    it('only lets the winner pay, exactly their bid', async () => {
      const notWinner = await api().post('/api/v1/payments/checkout').set(auth(bidders[0].token)).send({ auctionId: String(a.id) });
      assert.equal(notWinner.status, 403);
      const res = await api().post('/api/v1/payments/checkout').set(auth(bidders[1].token)).send({ auctionId: String(a.id) });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.data.amount.etb, '7.25');
      winnerRef = res.body.data.txRef;
    });

    it('settles through the callback; the seller is owed their price less 10%', async () => {
      fake.pay(winnerRef);
      const cb = await api().get(`/api/v1/payments/chapa/callback?trx_ref=${winnerRef}&ref_id=x&status=success`);
      assert.equal(cb.body.data.status, 'PAID');
      const result = await prisma.auctionResult.findUnique({ where: { auctionId: a.id } });
      assert.equal(result.status, 'PAID');
      const payout = await prisma.sellerPayout.findUnique({ where: { resultId: result.id } });
      assert.equal(payout.netAmount, ETB(900));
      assert.equal(payout.commission, ETB(100));
      assert.ok(await prisma.notification.findFirst({ where: { userId: seller.user.id, type: 'SALE_PAID' } }));
      await assertLedgerBalanced();
    });

    it('issues a receipt and shows the return page', async () => {
      const json = await api().get(`/api/v1/payments/${winnerRef}/receipt`).set(auth(bidders[1].token));
      assert.equal(json.body.data.totalPaid.etb, '7.25');
      assert.deepEqual(json.body.data.lines.map((l) => l.label), ['Winning bid']);
      const html = await api().get(`/api/v1/payments/${winnerRef}/receipt?format=html`).set(auth(bidders[1].token));
      assert.match(html.text, /Payment receipt/);
      assert.equal((await api().get(`/api/v1/payments/${winnerRef}/receipt`).set(auth(bidders[0].token))).status, 404);
      const page = await api().get(`/api/v1/payments/chapa/return?tx_ref=${winnerRef}`);
      assert.match(page.text, /Payment confirmed/);
      assert.match(page.text, /lowbid:\/\/payments\?tx_ref=/);
    });

    it('pays the seller after the buyer confirms receipt', async () => {
      const result = await prisma.auctionResult.findUnique({ where: { auctionId: a.id } });
      const payout = await prisma.sellerPayout.findUnique({ where: { resultId: result.id } });
      await settings.updateSetting('payout.policy', { disputeWindowDays: 3, method: 'CHAPA_TRANSFER' }, { actorId: admin.user.id });
      assert.equal((await api().post(`/api/v1/admin/payouts/${payout.id}/send`).set(auth(admin.token))).body.error.code, 'PAYOUT_NOT_DUE');
      const confirm = await api().post(`/api/v1/me/auctions/${a.id}/confirm-received`).set(auth(bidders[1].token));
      assert.equal(confirm.body.data.status, 'FULFILLED');
      const sent = await api().post(`/api/v1/admin/payouts/${payout.id}/send`).set(auth(admin.token));
      assert.equal(sent.status, 200, JSON.stringify(sent.body));
      assert.equal(fake.transfers.get(payout.reference).amount, '900.00');
      const balances = await assertLedgerBalanced();
      assert.equal(balances.SELLER_PAYABLE?.etb ?? '0.00', '0.00');
      await settings.updateSetting('payout.policy', { disputeWindowDays: 3, method: 'MANUAL_BANK_TRANSFER' }, { actorId: admin.user.id });
    });
  });

  // ─────────────── Non-payment and second chance ───────────────

  describe('winner does not pay', () => {
    let a;
    let lateRef;
    beforeAll(async () => {
      a = await auction();
      await paidBid(a.id, bidders[2], '4');
      await paidBid(a.id, bidders[3], '2');
      await closeNow(a.id); // 2 ETB (bidders[3]) wins, 4 ETB is next
      const res = await api().post('/api/v1/payments/checkout').set(auth(bidders[3].token)).send({ auctionId: String(a.id) });
      lateRef = res.body.data.txRef;
      await prisma.payment.update({ where: { txRef: lateRef }, data: { createdAt: new Date(Date.now() - 3 * 86_400_000) } });
      await prisma.auctionResult.update({ where: { auctionId: a.id }, data: { paymentDeadline: new Date(Date.now() - 1000) } });
    });

    it('gives a strike and offers the item to the next ranked bidder at their bid', async () => {
      const r = await results.expireUnpaidResult((await prisma.auctionResult.findUnique({ where: { auctionId: a.id } })).id);
      assert.equal(r.result, 'second-chance');
      const result = await prisma.auctionResult.findUnique({ where: { auctionId: a.id } });
      assert.equal(result.winnerId, bidders[2].user.id);
      assert.equal(result.finalPrice, ETB(4));
      assert.equal(result.offerRank, 2);
      assert.equal((await prisma.user.findUnique({ where: { id: bidders[3].user.id } })).paymentStrikes, 1);
      assert.ok(await prisma.notification.findFirst({ where: { userId: bidders[2].user.id, type: 'SECOND_CHANCE_OFFER' } }));
    });

    it('refunds a payment that arrives after the offer moved on', async () => {
      fake.pay(lateRef);
      await sendWebhook(fake.webhook(lateRef));
      const p = await prisma.payment.findUnique({ where: { txRef: lateRef } });
      const refund = await prisma.refund.findFirst({ where: { paymentId: p.id } });
      assert.equal(refund.kind, 'LATE_PAYMENT');
      await refunds.reconcileRefunds();
      fake.completeRefunds();
      await refunds.reconcileRefunds();
      assert.equal((await prisma.payment.findUnique({ where: { id: p.id } })).status, 'REFUNDED');
      await assertLedgerBalanced();
    });

    it('ends unsold when nobody else is left', async () => {
      await prisma.auctionResult.update({ where: { auctionId: a.id }, data: { paymentDeadline: new Date(Date.now() - 1000) } });
      const r = await results.expireUnpaidResult((await prisma.auctionResult.findUnique({ where: { auctionId: a.id } })).id);
      assert.equal(r.result, 'expired');
    });
  });

  // ─────────────── Fee refunds and buyer refunds ───────────────

  describe('refunds', () => {
    it('refunds bid fees through Chapa when an auction is cancelled', async () => {
      const a = await auction();
      const ref = await paidBid(a.id, bidders[0], '5');
      await api().post(`/api/v1/admin/auctions/${a.id}/cancel`).set(auth(admin.token)).send({ reason: 'Listing error' });
      await refunds.reconcileRefunds();
      fake.completeRefunds();
      await refunds.reconcileRefunds();
      assert.equal((await prisma.payment.findUnique({ where: { txRef: ref } })).status, 'REFUNDED');
      assert.ok(await prisma.notification.findFirst({ where: { userId: bidders[0].user.id, type: 'REFUND_ISSUED' } }));
      await assertLedgerBalanced();
    });

    it('holds the payout, refunds after approval, and cancels the seller payout', async () => {
      const a = await auction();
      await paidBid(a.id, bidders[2], '9');
      await closeNow(a.id);
      const co = await api().post('/api/v1/payments/checkout').set(auth(bidders[2].token)).send({ auctionId: String(a.id) });
      fake.pay(co.body.data.txRef);
      await sendWebhook(fake.webhook(co.body.data.txRef));
      const req = await api().post(`/api/v1/payments/${co.body.data.txRef}/refund-request`).set(auth(bidders[2].token)).send({ reason: 'Item not as described' });
      assert.equal(req.status, 201, JSON.stringify(req.body));
      const result = await prisma.auctionResult.findUnique({ where: { auctionId: a.id } });
      assert.equal((await prisma.sellerPayout.findUnique({ where: { resultId: result.id } })).status, 'ON_HOLD');
      await api().post(`/api/v1/admin/refunds/${req.body.data.id}/approve`).set(auth(admin.token));
      await refunds.reconcileRefunds();
      fake.completeRefunds();
      await refunds.reconcileRefunds();
      assert.equal((await prisma.auctionResult.findUnique({ where: { auctionId: a.id } })).status, 'CANCELLED');
      assert.equal((await prisma.sellerPayout.findUnique({ where: { resultId: result.id } })).status, 'CANCELLED');
      await assertLedgerBalanced();
    });
  });

  describe('reconciliation', () => {
    it('expires fee checkouts nobody finished, voiding their bids', async () => {
      const a = await auction();
      const res = await bid(a.id, bidders[3].token, '8');
      const txRef = res.body.data.payment.txRef;
      await prisma.payment.update({ where: { txRef }, data: { createdAt: new Date(Date.now() - 3_600_000), expiresAt: new Date(Date.now() - 30 * 60_000) } });
      const payments = await import('../../src/modules/payments/payments.service.js');
      const out = await payments.reconcilePayments();
      assert.ok(out.expired >= 1);
      assert.equal((await prisma.payment.findUnique({ where: { txRef } })).status, 'EXPIRED');
      assert.equal((await prisma.bid.findUnique({ where: { id: BigInt(res.body.data.bid.id) } })).status, 'VOID');
    });

    it('lists payments needing review for admins', async () => {
      const res = await api().get('/api/v1/admin/payments?needsReview=true').set(auth(admin.token));
      assert.ok(res.body.data.length >= 1);
      assert.equal((await api().get('/api/v1/admin/payments').set(auth(bidders[0].token))).status, 403);
    });
  });
});
