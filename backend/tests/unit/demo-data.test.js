import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'bun:test';
import { buildBids, rng } from '../../src/db/demo/bid-history.js';
import { DEMO_BIDDERS, DEMO_ITEMS } from '../../src/db/demo/demo-catalog.js';
import { etbToMinor } from '../../src/utils/money.js';
import { normalizeEthiopianPhone } from '../../src/utils/phone.js';

const seedSource = readFileSync(new URL('../../src/db/seed.js', import.meta.url), 'utf8');
const categorySlugs = new Set([...seedSource.matchAll(/slug: '([a-z-]+)'/g)].map((m) => m[1]));

describe('demo catalog', () => {
  it('uses only demo phone numbers', () => {
    for (const p of DEMO_BIDDERS.map((u) => u.phone)) {
      assert.ok(normalizeEthiopianPhone(p)?.startsWith('+25190000'), p);
    }
  });

  it('has unique item keys and titles, and known categories', () => {
    const keys = new Set();
    // Titles identify demo listings when the demo is reloaded, so they must be unique.
    assert.equal(new Set(DEMO_ITEMS.map((i) => i.title)).size, DEMO_ITEMS.length);
    for (const item of DEMO_ITEMS) {
      assert.ok(!keys.has(item.key), `duplicate ${item.key}`);
      keys.add(item.key);
      assert.ok(categorySlugs.has(item.category), `${item.key}: unknown category ${item.category}`);
    }
  });

  it('covers phones/tablets and home appliances in every auction state', () => {
    for (const cat of ['mobile-phones-tablets', 'home-appliances']) {
      const items = DEMO_ITEMS.filter((i) => i.category === cat);
      assert.ok(items.length >= 8, `${cat} has ${items.length} items`);
      for (const state of ['live', 'upcoming', 'closed']) {
        assert.ok(items.some((i) => i.schedule[state]), `${cat} has no ${state} auction`);
      }
    }
    assert.ok(DEMO_ITEMS.some((i) => i.schedule.live && i.schedule.live.endsIn <= 10), 'something must be ending soon');
  });

  it('has valid ETB amounts and no bids on upcoming auctions', () => {
    for (const item of DEMO_ITEMS) {
      assert.ok(etbToMinor(item.priceEtb) >= 10_000n, item.key);
      if (item.schedule.upcoming) assert.equal(item.bids, 0, item.key);
    }
  });
});

describe('buildBids', () => {
  const bidders = DEMO_BIDDERS.map((b, i) => ({ id: BigInt(i + 1), ...b }));
  const startsAt = new Date('2026-11-07T08:00:00Z');
  const lastBidAt = new Date('2026-11-07T18:00:00Z');

  for (const item of DEMO_ITEMS.filter((i) => i.bids > 0)) {
    it(`builds a valid lowest-unique-bid history for ${item.key}`, () => {
      const bids = buildBids(item, bidders, startsAt, lastBidAt, rng(item.key));
      assert.ok(bids.length >= item.bids, 'plenty of bids');
      const seen = new Set();
      for (const b of bids) {
        assert.equal(b.status, 'ACTIVE');
        assert.ok(b.amount >= 1n && b.amount <= 9_999n, 'small amounts, 0.01–99.99 ETB');
        assert.ok(b.createdAt >= startsAt && b.createdAt <= lastBidAt, 'inside the auction window');
        const key = `${b.bidderId}:${b.amount}`;
        assert.ok(!seen.has(key), 'nobody bids the same amount twice');
        seen.add(key);
      }
      assert.equal(new Set(bids.map((b) => b.idempotencyKey)).size, bids.length);
    });
  }

  it('produces shared amounts, so uniqueness matters', () => {
    const item = DEMO_ITEMS.find((i) => i.bids >= 9);
    const bids = buildBids(item, bidders, startsAt, lastBidAt, rng(item.key));
    const counts = new Map();
    for (const b of bids) counts.set(b.amount, (counts.get(b.amount) ?? 0) + 1);
    assert.ok([...counts.values()].some((n) => n > 1));
    assert.ok([...counts.values()].some((n) => n === 1));
  });

  it('is deterministic', () => {
    const item = DEMO_ITEMS[0];
    const a = buildBids(item, bidders, startsAt, lastBidAt, rng(item.key));
    const b = buildBids(item, bidders, startsAt, lastBidAt, rng(item.key));
    assert.deepEqual(a, b);
  });
});
