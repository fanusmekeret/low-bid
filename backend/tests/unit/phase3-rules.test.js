import assert from 'node:assert/strict';
import { describe, it } from 'bun:test';
import { buildCategoryTree } from '../../src/modules/categories/categories.tree.js';
import { TEMPLATES } from '../../src/modules/notifications/notifications.templates.js';
import { createProductSchema } from '../../src/modules/products/products.schemas.js';
import { deleteMode, editLock, statusAfterEdit, submitBlocker, validImageOrder } from '../../src/modules/products/products.rules.js';
import { applySchema, updateProfileSchema } from '../../src/modules/sellers/sellers.schemas.js';
import { applyDecision, maskAccount, verificationGaps } from '../../src/modules/sellers/sellers.rules.js';
import { SETTING_DEFINITIONS } from '../../src/modules/settings/settings.definitions.js';
import { DEMO_SPECS } from '../../src/db/demo/demo-specs.js';

describe('seller verification rules', () => {
  const doc = (documentType, status = 'PENDING') => ({ documentType, status });

  it('needs an identity document', () => {
    assert.deepEqual(verificationGaps({ businessType: 'INDIVIDUAL', documents: [] }), ['IDENTITY_DOCUMENT']);
    assert.deepEqual(verificationGaps({ businessType: 'INDIVIDUAL', documents: [doc('FAYDA_ID')] }), []);
    assert.deepEqual(verificationGaps({ businessType: 'INDIVIDUAL', documents: [doc('KEBELE_ID', 'APPROVED')] }), []);
  });

  it('ignores rejected documents', () => {
    assert.deepEqual(verificationGaps({ businessType: 'INDIVIDUAL', documents: [doc('PASSPORT', 'REJECTED')] }), ['IDENTITY_DOCUMENT']);
  });

  it('needs a trade licence and TIN for companies', () => {
    assert.deepEqual(verificationGaps({ businessType: 'COMPANY', documents: [doc('FAYDA_ID')] }), ['TRADE_LICENSE', 'TIN_NUMBER']);
    assert.deepEqual(verificationGaps({ businessType: 'COMPANY', tinNumber: '0012345678', documents: [doc('FAYDA_ID'), doc('TRADE_LICENSE')] }), []);
  });

  it('decides who can apply', () => {
    assert.equal(applyDecision(undefined), 'create');
    assert.equal(applyDecision('REJECTED'), 'reapply');
    for (const s of ['PENDING', 'APPROVED', 'SUSPENDED']) assert.equal(typeof applyDecision(s), 'object', s);
  });

  it('masks account numbers', () => assert.equal(maskAccount('1000123456789'), '•••• 6789'));
});

describe('seller application form', () => {
  const base = { businessName: 'Bole Mobile', businessType: 'INDIVIDUAL', city: 'Addis Ababa', payoutMethod: 'BANK_TRANSFER', payoutBankCode: 'CBE', payoutAccountName: 'Samuel T', payoutAccountNo: '1000123456789' };

  it('accepts a valid individual', () => applySchema.parse(base));
  it('requires a TIN for companies', () => assert.throws(() => applySchema.parse({ ...base, businessType: 'COMPANY' })));
  it('requires a 10-digit TIN', () => assert.throws(() => applySchema.parse({ ...base, tinNumber: '12345' })));
  it('requires a bank for bank transfers', () => assert.throws(() => applySchema.parse({ ...base, payoutBankCode: undefined })));
  it('rejects letters in bank accounts', () => assert.throws(() => applySchema.parse({ ...base, payoutAccountNo: '1000ABC45678' })));
  it('normalizes telebirr numbers', () => {
    const v = applySchema.parse({ ...base, payoutMethod: 'TELEBIRR', payoutBankCode: undefined, payoutAccountNo: '0912345678' });
    assert.equal(v.payoutAccountNo, '+251912345678');
  });
  it('rejects bad telebirr numbers', () => assert.throws(() => applySchema.parse({ ...base, payoutMethod: 'TELEBIRR', payoutAccountNo: '12345678' })));
  it('requires payout fields together on update', () => {
    assert.throws(() => updateProfileSchema.parse({ payoutAccountNo: '1000123456789' }));
    updateProfileSchema.parse({ bio: 'Phones since 2015' });
  });
});

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

  it('sends edited approved listings back for review', () => {
    assert.equal(statusAfterEdit('APPROVED'), 'PENDING_REVIEW');
    for (const s of ['DRAFT', 'PENDING_REVIEW', 'REJECTED']) assert.equal(statusAfterEdit(s), s);
  });

  it('only submits drafts or rejected listings with photos', () => {
    assert.equal(submitBlocker({ status: 'DRAFT' }, { imageCount: 1, minImages: 1 }), null);
    assert.equal(submitBlocker({ status: 'REJECTED' }, { imageCount: 3, minImages: 1 }), null);
    assert.equal(submitBlocker({ status: 'DRAFT' }, { imageCount: 0, minImages: 1 }).code, 'PRODUCT_NEEDS_IMAGES');
    assert.equal(submitBlocker({ status: 'APPROVED' }, { imageCount: 3, minImages: 1 }).code, 'PRODUCT_NOT_SUBMITTABLE');
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
  it('keeps the 10% seller commission decision', () => {
    assert.equal(SETTING_DEFINITIONS['fees.commission'].default.sellerCommissionBp, 1000);
    assert.equal(SETTING_DEFINITIONS['fees.commission'].default.buyerPremiumBp, 0);
  });
  it('defaults to a 10 ETB bid fee and bids from 0.01 ETB', () => {
    const d = SETTING_DEFINITIONS['auction.lowestUniqueBid'].default;
    assert.equal(d.defaultBidFeeMinor, '1000');
    assert.equal(d.minBidMinor, '1');
  });
  it('rejects a commission above 100%', () => assert.throws(() => SETTING_DEFINITIONS['fees.commission'].schema.parse({ ...SETTING_DEFINITIONS['fees.commission'].default, sellerCommissionBp: 20000 })));
});

describe('notification templates', () => {
  for (const [type, t] of Object.entries(TEMPLATES)) {
    it(`${type} has English and Amharic text`, () => {
      const out = t({ title: 'Samsung Galaxy A55 5G 256GB', reason: 'Photos are blurry', amount: 'ETB 165,000', hours: 48, minutes: 15, reserveMissed: true, receiptNo: 'LB-R-20261109-000123', reference: 'LB-P-7-abc' });
      for (const k of ['titleEn', 'titleAm', 'bodyEn', 'bodyAm']) {
        assert.ok(out[k]?.length > 0, k);
        assert.ok(!out[k].includes('undefined'), `${k} has every value filled in`);
        assert.ok(out[k].length <= (k.startsWith('title') ? 150 : 500), `${k} fits the column`);
      }
    });
  }
});
