import assert from 'node:assert/strict';
import { describe, it } from 'bun:test';
import { buildCategoryTree } from '../../src/modules/categories/categories.tree.js';
import { TEMPLATES } from '../../src/modules/notifications/notifications.templates.js';
import { createProductSchema } from '../../src/modules/products/products.schemas.js';
import { deleteMode, editLock, publishBlocker, validImageOrder } from '../../src/modules/products/products.rules.js';
import { SETTING_DEFINITIONS } from '../../src/modules/settings/settings.definitions.js';
import { DEMO_SPECS } from '../../src/db/demo/demo-specs.js';

describe('product rules', () => {
  const auction = (status, outcome) => ({ status, result: outcome ? { outcome } : null });

  it('locks listings with active or sold auctions', () => {
    assert.equal(editLock({ status: 'APPROVED', auctions: [] }), null);
    assert.equal(editLock({ status: 'APPROVED', auctions: [auction('LIVE')] }).code, 'PRODUCT_LOCKED');
    assert.equal(editLock({ status: 'APPROVED', auctions: [auction('SCHEDULED')] }).code, 'PRODUCT_LOCKED');
    assert.equal(editLock({ status: 'APPROVED', auctions: [auction('CLOSED', 'SOLD')] }).code, 'PRODUCT_SOLD');
    assert.equal(editLock({ status: 'APPROVED', auctions: [auction('CLOSED', 'NO_BIDS')] }), null, 'unsold items can be relisted');
    assert.equal(editLock({ status: 'ARCHIVED', auctions: [] }).code, 'PRODUCT_ARCHIVED');
  });

  it('only publishes drafts with photos', () => {
    assert.equal(publishBlocker({ status: 'DRAFT' }, { imageCount: 1, minImages: 1 }), null);
    assert.equal(publishBlocker({ status: 'DRAFT' }, { imageCount: 0, minImages: 1 }).code, 'PRODUCT_NEEDS_IMAGES');
    assert.equal(publishBlocker({ status: 'APPROVED' }, { imageCount: 3, minImages: 1 }).code, 'PRODUCT_NOT_DRAFT');
    assert.equal(publishBlocker({ status: 'ARCHIVED' }, { imageCount: 3, minImages: 1 }).code, 'PRODUCT_NOT_DRAFT');
  });

  it('archives instead of deleting anything with history', () => {
    assert.equal(deleteMode({ status: 'DRAFT', auctions: [] }), 'delete');
    assert.equal(deleteMode({ status: 'APPROVED', auctions: [] }), 'archive');
    assert.equal(deleteMode({ status: 'PENDING_REVIEW', auctions: [] }), 'archive');
    assert.equal(deleteMode({ status: 'REJECTED', auctions: [] }), 'archive');
    assert.equal(deleteMode({ status: 'DRAFT', auctions: [auction('CANCELLED')] }), 'archive');
  });

  it('validates photo order', () => {
    assert.equal(validImageOrder([1n, 2n, 3n], [3n, 1n, 2n]), true);
    assert.equal(validImageOrder([1n, 2n, 3n], [3n, 1n]), false);
    assert.equal(validImageOrder([1n, 2n, 3n], [3n, 3n, 1n]), false);
    assert.equal(validImageOrder([1n, 2n], [1n, 9n]), false);
  });
});

describe('product form', () => {
  const base = {
    categoryId: 2, title: 'iPhone 13 128GB Midnight', condition: 'USED_GOOD', location: 'Hawassa',
    description: 'Battery health 86%, small scratch on the back.', attributes: DEMO_SPECS['iphone-13'],
  };
  it('accepts a full listing', () => createProductSchema.parse(base));
  it('rejects prices in the title', () => assert.throws(() => createProductSchema.parse({ ...base, title: 'iPhone 13 only 50000 birr' })));
  it('requires a spec sheet', () => assert.throws(() => createProductSchema.parse({ ...base, attributes: undefined })));
  it('requires a real description', () => assert.throws(() => createProductSchema.parse({ ...base, description: 'Good phone' })));
});

describe('category tree', () => {
  const row = (id, parentId, sortOrder, nameEn) => ({ id, parentId, sortOrder, nameEn, nameAm: nameEn, slug: `c${id}`, iconKey: null, isActive: true, defaultBidFee: 0n });
  it('nests children under parents in order', () => {
    const tree = buildCategoryTree([row(3, 1, 20, 'Tablets'), row(1, null, 10, 'Electronics'), row(2, 1, 10, 'Phones'), row(4, null, 5, 'Vehicles')]);
    assert.deepEqual(tree.map((c) => c.nameEn), ['Vehicles', 'Electronics']);
    assert.deepEqual(tree[1].children.map((c) => c.nameEn), ['Phones', 'Tablets']);
    assert.equal(tree[0].defaultBidFee.etb, '0.00');
  });
  it('treats orphans as top level', () => {
    assert.equal(buildCategoryTree([row(5, 99, 0, 'Orphan')])[0].nameEn, 'Orphan');
  });
});

describe('platform settings', () => {
  for (const [key, def] of Object.entries(SETTING_DEFINITIONS)) {
    it(`${key} default passes its own validation`, () => def.schema.parse(def.default));
  }
  it('charges no buyer premium by default (LOW BID earns from bid fees)', () => {
    assert.equal(SETTING_DEFINITIONS.fees.default.buyerPremiumBp, 0);
  });
  it('defaults to a 10 ETB bid fee and bids from 0.01 ETB', () => {
    const d = SETTING_DEFINITIONS['auction.lowestUniqueBid'].default;
    assert.equal(d.defaultBidFeeMinor, '1000');
    assert.equal(d.minBidMinor, '1');
  });
  it('rejects a premium above 100%', () => assert.throws(() => SETTING_DEFINITIONS.fees.schema.parse({ buyerPremiumBp: 20000 })));
});

describe('notification templates', () => {
  for (const [type, t] of Object.entries(TEMPLATES)) {
    it(`${type} has English and Amharic text`, () => {
      const out = t({ title: 'Samsung Galaxy A55 5G 256GB', reason: 'Photos are blurry', amount: 'ETB 165,000', hours: 48, minutes: 15, days: 3, receiptNo: 'LB-R-20261109-000123', reference: 'LB-P-7-abc' });
      for (const k of ['titleEn', 'titleAm', 'bodyEn', 'bodyAm']) {
        assert.ok(out[k]?.length > 0, k);
        assert.ok(!out[k].includes('undefined'), `${k} has every value filled in`);
        assert.ok(out[k].length <= (k.startsWith('title') ? 150 : 500), `${k} fits the column`);
      }
    });
  }
});
