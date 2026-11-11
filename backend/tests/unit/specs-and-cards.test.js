import assert from 'node:assert/strict';
import { describe, it } from 'bun:test';
import { DEMO_ITEMS } from '../../src/db/demo/demo-catalog.js';
import { DEMO_SPECS } from '../../src/db/demo/demo-specs.js';
import { presentAuctionCard, presentAuctionDetail } from '../../src/modules/auctions/auction.presenter.js';
import { NO_PRICE, productAttributesSchema } from '../../src/modules/products/specs.schema.js';

describe('demo spec sheets', () => {
  for (const item of DEMO_ITEMS) {
    it(`${item.key} has a valid spec sheet`, () => {
      const attrs = DEMO_SPECS[item.key];
      assert.ok(attrs, 'missing spec sheet');
      productAttributesSchema.parse(attrs);
      assert.equal(attrs.highlights.length, 3, 'cards need three highlights');
      assert.ok(attrs.specs.length >= 3, 'at least three spec groups');
      assert.ok(!NO_PRICE.test(item.description), 'description must not mention a price');
    });
  }

  it('has no spec sheets for items that do not exist', () => {
    const keys = new Set(DEMO_ITEMS.map((i) => i.key));
    for (const k of Object.keys(DEMO_SPECS)) assert.ok(keys.has(k), k);
  });
});

describe('spec sheet validation', () => {
  const sheet = (highlight, value) => ({ highlights: [highlight], specs: [{ group: 'General', rows: [{ label: 'Model', value }] }] });
  it('rejects prices in highlights', () => assert.throws(() => productAttributesSchema.parse(sheet('Only 50,000 ETB', 'X'))));
  it('rejects prices in Amharic', () => assert.throws(() => productAttributesSchema.parse(sheet('128GB', '50,000 ብር'))));
  it('rejects birr in values', () => assert.throws(() => productAttributesSchema.parse(sheet('128GB', 'Worth 60000 birr'))));
  it('accepts normal specs', () => productAttributesSchema.parse(sheet('128GB', 'iPhone 13')));
});

describe('auction presenters', () => {
  const imageUrls = (key) => ({ sm: `https://cdn.test/${key}_sm.webp`, md: `https://cdn.test/${key}_md.webp`, lg: `https://cdn.test/${key}_lg.webp` });
  const auction = {
    id: 7n, status: 'LIVE', startsAt: new Date(), endsAt: new Date(Date.now() + 60_000),
    isFeatured: true, bidCount: 14, itemCost: 14500000n, marketValue: 16400000n,
    bidFee: 1000n, minBid: 1n, maxBid: 14500000n, bidStep: 1n, minPaidBids: 0, maxBidsPerUser: 50, currentWinnerId: null,
    product: {
      title: 'iPhone 15 Pro Max 256GB', condition: 'LIKE_NEW', location: 'Bole, Addis Ababa', description: 'Battery 94%.',
      attributes: DEMO_SPECS['iphone-15-pro-max'],
      images: [{ key: 'demo/iphone-15-pro-max/1' }],
      category: { slug: 'mobile-phones-tablets', nameEn: 'Mobile phones and tablets', nameAm: 'ሞባይል' },
      seller: { id: 1n, businessName: 'Bole Mobile Center', city: 'Addis Ababa', ratingAvg: 465, ratingCount: 24 },
    },
  };

  it('never puts a price on a card', () => {
    const card = presentAuctionCard(auction, { imageUrls });
    const text = JSON.stringify(card, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    for (const field of ['price', 'marketValue', 'itemCost', 'bidding', 'bidFee']) assert.ok(!(field in card), field);
    assert.ok(!text.includes('16400000') && !text.includes('14500000'), 'no price values on the card');
    assert.deepEqual(card.highlights, ['256GB', '6.7" 120 Hz OLED', 'Battery 94%']);
    assert.ok(card.endsAt, 'card keeps the countdown');
    assert.equal(card.coverImage.sm, 'https://cdn.test/demo/iphone-15-pro-max/1_sm.webp');
  });

  it('shows the bidding terms and full spec sheet on the detail page, but no bid amounts', () => {
    const d = presentAuctionDetail(auction, { imageUrls });
    assert.equal(d.bidding.bidFee.etb, '10.00');
    assert.equal(d.bidding.minBid.etb, '0.01');
    assert.equal(d.bidding.maxBid.etb, '145000.00');
    assert.equal(d.marketValue.etb, '164000.00');
    assert.ok(!('itemCost' in d), 'the item cost is not public');
    assert.ok(!('currentPrice' in d) && !('price' in d));
    assert.ok(d.specs.length >= 5);
    assert.equal(d.images.length, 1);
    assert.match(d.images[0].lg, /_lg\.webp$/);
  });
});
