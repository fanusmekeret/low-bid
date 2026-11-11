import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, it } from 'bun:test';
import { startFakeChapa } from './fake-chapa.js';
import { hasTestDb } from './helpers.js';

// Lowest-unique-bid auctions end to end: create → approve → bid (each bid's fee paid through
// the fake Chapa) → secret while open → close → ranking revealed.

const key = () => randomUUID();

describe.skipIf(!hasTestDb)('lowest unique bid auctions (MySQL + fake Chapa)', () => {
  /** @type {Awaited<ReturnType<typeof import('./helpers.js').setup>>} */
  let ctx;
  let fake;
  let request;
  let prisma;
  let lifecycle;
  let events;
  let signAccessToken;
  let DEMO_SPECS;
  let admin;
  let listing;
  let bidders; // [{ user, token }]
  let phoneSeq = 0;

  const api = () => request(ctx.app);
  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const bid = (auctionId, token, amountEtb, idempotencyKey = key()) =>
    api().post(`/api/v1/auctions/${auctionId}/bids`).set(auth(token)).send({ amount: String(amountEtb), idempotencyKey });
  const sendWebhook = ({ raw, headers }) => api().post('/api/v1/payments/chapa/webhook').set(headers).send(raw);

  /** Places a bid and pays its fee (as the buyer would on Chapa's page). */
  async function paidBid(auctionId, who, amountEtb) {
    const res = await bid(auctionId, who.token, amountEtb);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    fake.pay(res.body.data.payment.txRef);
    assert.equal((await sendWebhook(fake.webhook(res.body.data.payment.txRef))).status, 200);
    return res.body.data;
  }

  async function makeUsers(n, roles = ['buyer', 'bidder'], verified = true) {
    const roleRows = await prisma.role.findMany({ where: { code: { in: roles } } });
    const out = [];
    for (let i = 0; i < n; i += 1) {
      phoneSeq += 1;
      const user = await prisma.user.create({
        data: {
          phone: `+2519120${String(phoneSeq).padStart(5, '0')}`, firstName: `Bidder${phoneSeq}`, lastName: 'Test', passwordHash: 'x',
          phoneVerifiedAt: verified ? new Date() : null, roles: { create: roleRows.map((r) => ({ roleId: r.id })) },
        },
      });
      out.push({ user, token: signAccessToken(user, roles).token });
    }
    return out;
  }

  /** A published LOW BID listing (LOW BID is the only seller). */
  async function makeListing(categorySlug = 'mobile-phones-tablets') {
    const house = await (await import('../../src/modules/house/house.service.js')).getHouseSeller();
    const category = await prisma.category.findUnique({ where: { slug: categorySlug } });
    phoneSeq += 1;
    const product = await prisma.product.create({
      data: {
        sellerId: house.id, categoryId: category.id, title: `Samsung Galaxy S24 Ultra ${phoneSeq}`, condition: 'NEW', location: 'Bole',
        description: 'Sealed box, dual SIM, international version.', status: 'APPROVED', attributes: DEMO_SPECS['galaxy-s24-ultra'],
      },
    });
    return { product, category };
  }

  async function liveAuction(over = {}) {
    const now = Date.now();
    return prisma.auction.create({
      data: {
        productId: listing.product.id, status: 'LIVE', itemCost: 12_000_000n, marketValue: 13_500_000n,
        bidFee: 1000n, minBid: 1n, maxBid: 12_000_000n, bidStep: 1n, maxBidsPerUser: 5,
        startsAt: new Date(now - 3_600_000), endsAt: new Date(now + 3_600_000), ...over,
      },
    });
  }

  async function closeNow(auctionId) {
    await prisma.auction.update({ where: { id: auctionId }, data: { endsAt: new Date(Date.now() - 10 * 60_000) } });
    return lifecycle.closeAuction(auctionId);
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
    ({ signAccessToken } = await import('../../src/modules/auth/tokens.js'));
    ({ DEMO_SPECS } = await import('../../src/db/demo/demo-specs.js'));
    events = (await import('../../src/sockets/realtime.js')).captureRealtime();
    [admin] = await makeUsers(1, ['buyer', 'bidder', 'super_admin']);
    listing = await makeListing();
    bidders = await makeUsers(12);
  });
  beforeEach(() => { events.length = 0; });
  afterAll(async () => {
    await ctx?.close();
    await fake?.close();
  });

  // ─────────────── Creating and approving ───────────────

  describe('LOW BID staff create and schedule auctions', () => {
    let auctionId;
    let own;
    beforeAll(async () => { own = await makeListing(); });

    it('validates the schedule and the item cost', async () => {
      const res = await api().post('/api/v1/admin/auctions').set(auth(admin.token)).send({
        productId: String(own.product.id), itemCost: '50', startsAt: new Date(Date.now() - 3_600_000).toISOString(), durationMinutes: 120,
      });
      assert.equal(res.status, 400);
      const paths = res.body.error.details.map((d) => d.path);
      assert.ok(paths.includes('startsAt') && paths.includes('itemCost'));
    });

    it('creates and schedules an auction with default bidding terms and locks the listing', async () => {
      const res = await api().post('/api/v1/admin/auctions').set(auth(admin.token)).send({
        productId: String(own.product.id), itemCost: '120000', marketValue: '135000',
        startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 24 * 60,
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const a = res.body.data;
      assert.equal(a.status, 'SCHEDULED', 'no approval step: LOW BID schedules it directly');
      assert.equal(a.bidFee.etb, '10.00', 'platform default fee');
      assert.equal(a.minBid.etb, '0.01');
      assert.equal(a.maxBid.etb, '120000.00', 'bids up to the item cost');
      auctionId = a.id;
      const edit = await api().patch(`/api/v1/admin/products/${own.product.id}`).set(auth(admin.token)).send({ location: 'Somewhere else' });
      assert.equal(edit.body.error.code, 'PRODUCT_LOCKED');
      const again = await api().post('/api/v1/admin/auctions').set(auth(admin.token)).send({
        productId: String(own.product.id), itemCost: '120000', startsAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 60,
      });
      assert.equal(again.body.error.code, 'AUCTION_ALREADY_EXISTS');
    });

    it('lets staff change the terms before bidding opens', async () => {
      const res = await api().patch(`/api/v1/admin/auctions/${auctionId}`).set(auth(admin.token)).send({ bidFee: '25', minPaidBids: 3, maxBidsPerUser: 10 });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.bidFee.etb, '25.00');
      assert.equal(res.body.data.minPaidBids, 3);
      assert.equal((await api().patch(`/api/v1/admin/auctions/${auctionId}`).set(auth(admin.token)).send({ bidFee: '0.50' })).status, 400);
    });

    it('is visible to buyers once scheduled, but rejects bids before the start', async () => {
      assert.equal((await api().get(`/api/v1/auctions/${auctionId}`)).status, 200);
      assert.equal((await bid(auctionId, bidders[0].token, 5)).body.error.code, 'AUCTION_NOT_STARTED');
    });

    it('keeps auction management away from buyers', async () => {
      assert.equal((await api().post('/api/v1/admin/auctions').set(auth(bidders[0].token)).send({})).status, 403);
    });

    it('starts straight away when the start time is now', async () => {
      const other = await makeListing();
      const res = await api().post('/api/v1/admin/auctions').set(auth(admin.token)).send({
        productId: String(other.product.id), itemCost: '5000', startsAt: new Date().toISOString(), durationMinutes: 60,
      });
      assert.equal(res.body.data.status, 'LIVE');
    });
  });

  // ─────────────── Placing bids ───────────────

  describe('placing a bid', () => {
    let a;
    let first;
    beforeAll(async () => { a = await liveAuction(); });

    it('records the bid as awaiting its fee and opens a Chapa checkout for the fee', async () => {
      const res = await bid(a.id, bidders[0].token, '3.45');
      assert.equal(res.status, 201, JSON.stringify(res.body));
      first = res.body.data;
      assert.equal(first.bid.status, 'PENDING_PAYMENT');
      assert.equal(first.bid.amount.etb, '3.45');
      assert.equal(first.payment.purpose, 'BID_FEE');
      assert.equal(first.payment.amount.etb, '10.00');
      assert.match(first.payment.txRef, /^LB-F-/);
      assert.match(first.payment.checkoutUrl, /^https:\/\/checkout\.chapa\.test\//);
      const init = fake.calls.find((c) => c.path === '/v1/transaction/initialize' && c.body.tx_ref === first.payment.txRef);
      assert.equal(init.body.amount, '10.00');
      assert.equal((await prisma.auction.findUnique({ where: { id: a.id } })).bidCount, 0, 'unpaid bids do not count');
    });

    it('activates the bid once Chapa confirms the fee, and broadcasts only the count', async () => {
      fake.pay(first.payment.txRef);
      await sendWebhook(fake.webhook(first.payment.txRef));
      const b = await prisma.bid.findUnique({ where: { id: BigInt(first.bid.id) } });
      assert.equal(b.status, 'ACTIVE');
      assert.ok(b.activatedAt);
      const ev = events.find((e) => e.event === 'auction:bid');
      assert.equal(ev.payload.bidCount, 1);
      assert.ok(!('amount' in ev.payload), 'amounts are never broadcast');
      assert.ok(await prisma.notification.findFirst({ where: { userId: bidders[0].user.id, type: 'BID_CONFIRMED' } }));
    });

    it('validates amounts, duplicates and limits', async () => {
      assert.equal((await bid(a.id, bidders[0].token, '3.45')).body.error.code, 'DUPLICATE_BID_AMOUNT');
      assert.equal((await bid(a.id, bidders[0].token, '0')).body.error.code, 'BID_OUT_OF_RANGE');
      assert.equal((await bid(a.id, bidders[0].token, '120000.01')).body.error.code, 'BID_OUT_OF_RANGE');
      for (const amt of ['1', '2', '4', '5', '6']) assert.equal((await bid(a.id, bidders[1].token, amt)).status, 201);
      assert.equal((await bid(a.id, bidders[1].token, '7')).body.error.code, 'BID_LIMIT_REACHED', 'five bids per person on this auction');
    });

    it('requires a verified phone', async () => {
      const [u] = await makeUsers(1, ['buyer'], false);
      assert.equal((await bid(a.id, u.token, '7')).status, 403);
    });

    it('never places the same bid twice', async () => {
      const k = key();
      const one = await bid(a.id, bidders[2].token, '8', k);
      const two = await bid(a.id, bidders[2].token, '8', k);
      assert.equal(one.status, 201);
      assert.equal(two.status, 200);
      assert.equal(two.body.data.replay, true);
      assert.equal(two.body.data.payment.txRef, one.body.data.payment.txRef);
      assert.equal((await bid(a.id, bidders[3].token, '9', k)).body.error.code, 'IDEMPOTENCY_KEY_REUSED');
    });

    it('frees the amount when the fee payment fails', async () => {
      const res = await bid(a.id, bidders[4].token, '11');
      fake.fail(res.body.data.payment.txRef);
      await api().get(`/api/v1/payments/${res.body.data.payment.txRef}`).set(auth(bidders[4].token));
      assert.equal((await prisma.bid.findUnique({ where: { id: BigInt(res.body.data.bid.id) } })).status, 'VOID');
      assert.equal((await bid(a.id, bidders[4].token, '11')).status, 201, 'can bid the same amount again');
    });

    it('keeps amounts secret while bidding is open', async () => {
      const history = await api().get(`/api/v1/auctions/${a.id}/bids`).set(auth(bidders[0].token));
      assert.equal(history.status, 403);
      assert.equal(history.body.error.code, 'BIDS_SECRET');
      const page = await api().get(`/api/v1/auctions/${a.id}`).set(auth(bidders[0].token));
      const text = JSON.stringify(page.body);
      assert.ok(!text.includes('"3.45"'), 'my amount is not on the public page');
      assert.equal(page.body.data.viewer.myBidCount, 1);
      assert.equal(page.body.data.viewer.myStatus, 'BIDDING');
      assert.equal(page.body.data.bidding.bidFee.etb, '10.00');
      const staffView = await api().get(`/api/v1/admin/auctions/${a.id}`).set(auth(admin.token));
      assert.ok(!JSON.stringify(staffView.body).includes('"3.45"'), 'the staff auction view has no bid amounts either');
    });

    it('shows me my own bids', async () => {
      const mine = await api().get(`/api/v1/auctions/${a.id}/bids/mine`).set(auth(bidders[1].token));
      assert.deepEqual(mine.body.data.map((b) => b.amount.etb), ['1.00', '2.00', '4.00', '5.00', '6.00']);
      assert.ok(mine.body.data.every((b) => b.status === 'PENDING_PAYMENT' && b.checkoutUrl));
    });
  });

  // ─────────────── Closing ───────────────

  describe('closing and winner selection', () => {
    it('does nothing before the end time', async () => {
      const a = await liveAuction();
      assert.equal((await lifecycle.closeAuction(a.id)).result, 'not-due');
    });

    it('the lowest unique bid wins and everything is revealed', async () => {
      const a = await liveAuction();
      await paidBid(a.id, bidders[0], '1');
      await paidBid(a.id, bidders[1], '1'); // 1 ETB shared → not unique
      await paidBid(a.id, bidders[2], '2.50'); // lowest unique
      await paidBid(a.id, bidders[3], '3');
      await paidBid(a.id, bidders[3], '0.75'); // shared below
      await paidBid(a.id, bidders[4], '0.75');
      const r = await closeNow(a.id);
      assert.equal(r.result, 'closed');
      assert.equal(r.outcome, 'SOLD');
      const result = await prisma.auctionResult.findUnique({ where: { auctionId: a.id } });
      assert.equal(result.winnerId, bidders[2].user.id);
      assert.equal(result.finalPrice, 250n);
      assert.equal(result.totalDue, 250n, 'the winner pays their bid');

      const closed = events.find((e) => e.event === 'auction:closed');
      assert.equal(closed.payload.finalPrice.etb, '2.50');
      assert.equal(closed.payload.paidBids, 6);
      assert.equal(closed.payload.uniqueBids, 2);
      assert.ok(await prisma.notification.findFirst({ where: { userId: bidders[2].user.id, type: 'AUCTION_WON' } }));
      assert.ok(await prisma.notification.findFirst({ where: { userId: bidders[0].user.id, type: 'AUCTION_LOST' } }));

      const history = await api().get(`/api/v1/auctions/${a.id}/bids`).set(auth(bidders[2].token));
      assert.equal(history.status, 200);
      assert.deepEqual(history.body.data.map((b) => b.amount.etb), ['2.50', '3.00', '0.75', '0.75', '1.00', '1.00']);
      assert.equal(history.body.data[0].isWinning, true);
      assert.equal(history.body.data[0].isYou, true);
      assert.equal(history.body.data[2].unique, false);

      const page = await api().get(`/api/v1/auctions/${a.id}`).set(auth(bidders[2].token));
      assert.equal(page.body.data.result.finalPrice.etb, '2.50');
      assert.equal(page.body.data.viewer.myStatus, 'WON');
    });

    it('with no unique amount, the lowest amount paid first wins', async () => {
      const a = await liveAuction();
      await paidBid(a.id, bidders[5], '4');
      await paidBid(a.id, bidders[6], '2');
      await paidBid(a.id, bidders[7], '4');
      await paidBid(a.id, bidders[8], '2');
      await closeNow(a.id);
      const result = await prisma.auctionResult.findUnique({ where: { auctionId: a.id } });
      assert.equal(result.winnerId, bidders[6].user.id);
      assert.equal(result.finalPrice, 200n);
    });

    it('skips a suspended winner', async () => {
      const a = await liveAuction();
      const [x, y] = await makeUsers(2);
      await paidBid(a.id, x, '1');
      await paidBid(a.id, y, '2');
      await prisma.user.update({ where: { id: x.user.id }, data: { status: 'SUSPENDED' } });
      await closeNow(a.id);
      assert.equal((await prisma.auctionResult.findUnique({ where: { auctionId: a.id } })).winnerId, y.user.id);
    });

    it('waits for fees still being confirmed, then counts them', async () => {
      const a = await liveAuction();
      await paidBid(a.id, bidders[9], '5');
      const late = await bid(a.id, bidders[10].token, '1');
      await prisma.auction.update({ where: { id: a.id }, data: { endsAt: new Date(Date.now() - 1000) } });
      const r1 = await lifecycle.closeAuction(a.id);
      assert.equal(r1.result, 'not-due', 'a fee is still pending inside the settle window');
      fake.pay(late.body.data.payment.txRef); // the bidder finishes paying just after the end
      await prisma.payment.update({ where: { txRef: late.body.data.payment.txRef }, data: { lastCheckedAt: null } }); // as if the next check came 30 s later
      const r2 = await lifecycle.closeAuction(a.id); // checks Chapa, finds it paid, closes
      assert.equal(r2.result, 'closed');
      assert.equal((await prisma.auctionResult.findUnique({ where: { auctionId: a.id } })).winnerId, bidders[10].user.id);
    });

    it('voids unpaid bids at the close and refunds a fee paid afterwards', async () => {
      const a = await liveAuction();
      await paidBid(a.id, bidders[11], '9');
      const unpaid = await bid(a.id, bidders[0].token, '1');
      const r = await closeNow(a.id); // past the settle window
      assert.equal(r.result, 'closed');
      assert.equal((await prisma.bid.findUnique({ where: { id: BigInt(unpaid.body.data.bid.id) } })).status, 'VOID');
      fake.pay(unpaid.body.data.payment.txRef);
      await sendWebhook(fake.webhook(unpaid.body.data.payment.txRef));
      const refund = await prisma.refund.findFirst({ where: { payment: { txRef: unpaid.body.data.payment.txRef } } });
      assert.equal(refund.kind, 'BID_FEE_REFUND');
    });

    it('refunds every fee when the minimum number of bids is not reached', async () => {
      const a = await liveAuction({ minPaidBids: 3 });
      await paidBid(a.id, bidders[1], '1');
      await paidBid(a.id, bidders[2], '2');
      const r = await closeNow(a.id);
      assert.equal(r.outcome, 'NOT_ENOUGH_BIDS');
      assert.equal(await prisma.refund.count({ where: { kind: 'BID_FEE_REFUND', payment: { auctionId: a.id } } }), 2);
    });

    it('closes an auction with no bids', async () => {
      const a = await liveAuction();
      assert.equal((await closeNow(a.id)).outcome, 'NO_BIDS');
    });

    it('lets an admin cancel a live auction, refunding fees', async () => {
      const a = await liveAuction();
      await paidBid(a.id, bidders[3], '1');
      const res = await api().post(`/api/v1/admin/auctions/${a.id}/cancel`).set(auth(admin.token)).send({ reason: 'Item damaged' });
      assert.equal(res.status, 200);
      assert.ok(await prisma.notification.findFirst({ where: { userId: bidders[3].user.id, type: 'AUCTION_CANCELLED' } }));
      assert.equal(await prisma.refund.count({ where: { kind: 'BID_FEE_REFUND', payment: { auctionId: a.id } } }), 1);
    });

    it('sweeps overdue auctions', async () => {
      const a = await liveAuction({ endsAt: new Date(Date.now() - 10 * 60_000) });
      await lifecycle.sweep();
      assert.equal((await prisma.auction.findUnique({ where: { id: a.id } })).status, 'CLOSED');
    });
  });

  // ─────────────── Catalog ───────────────

  describe('catalog, watchlist and my bids', () => {
    let a;
    beforeAll(async () => {
      a = await liveAuction();
      await paidBid(a.id, bidders[4], '6');
    });

    it('lists cards without prices', async () => {
      const res = await api().get('/api/v1/auctions?status=live&category=mobile-phones-tablets&pageSize=50');
      const c = res.body.data.find((x) => x.id === String(a.id));
      assert.ok(c);
      for (const f of ['price', 'marketValue', 'bidding', 'itemCost']) assert.ok(!(f in c));
      assert.equal(c.bidCount, 1);
    });

    it('builds the home screen', async () => {
      const res = await api().get('/api/v1/home');
      for (const rail of ['featured', 'endingSoon', 'live', 'upcoming', 'recentlyAdded', 'popularCategories', 'banners']) assert.ok(Array.isArray(res.body.data[rail]), rail);
    });

    it('watches and unwatches', async () => {
      assert.equal((await api().post(`/api/v1/auctions/${a.id}/watch`).set(auth(bidders[5].token))).status, 204);
      await api().delete(`/api/v1/auctions/${a.id}/watch`).set(auth(bidders[5].token));
      assert.equal((await api().get('/api/v1/me/watchlist').set(auth(bidders[5].token))).body.data.length, 0);
    });

    it('lists my bids, then my win', async () => {
      const mine = await api().get('/api/v1/me/bids').set(auth(bidders[4].token));
      assert.equal(mine.body.data.find((x) => x.id === String(a.id)).myStatus, 'BIDDING');
      await closeNow(a.id);
      const won = await api().get('/api/v1/me/auctions/won').set(auth(bidders[4].token));
      assert.equal(won.body.data.find((x) => x.id === String(a.id)).result.totalDue.etb, '6.00');
    });
  });

  // ─────────────── Socket.IO ───────────────

  describe('socket.io', () => {
    it('pushes bid counts (never amounts) to the auction room', async () => {
      const { initSockets } = await import('../../src/sockets/index.js');
      const { io: connect } = await import('socket.io-client');
      const server = http.createServer(ctx.app);
      const io = await initSockets(server);
      await new Promise((r) => server.listen(0, r));
      const url = `http://127.0.0.1:${server.address().port}/live`;
      const a = await liveAuction();
      const watcher = connect(url, { transports: ['websocket'] });
      try {
        const joined = await new Promise((r) => watcher.emit('auction:join', { auctionId: String(a.id) }, r));
        assert.equal(joined.ok, true);
        const got = new Promise((r) => watcher.once('auction:bid', r));
        await paidBid(a.id, bidders[6], '1.23');
        const ev = await got;
        assert.equal(ev.bidCount, 1);
        assert.ok(!JSON.stringify(ev).includes('1.23'));
      } finally {
        watcher.close();
        io.close();
        await new Promise((r) => server.close(r));
        (await import('../../src/sockets/realtime.js')).setRealtimeTarget(null);
      }
    });
  });
});
