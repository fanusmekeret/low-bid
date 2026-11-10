import assert from 'node:assert/strict';
import { afterAll, beforeAll, describe, it } from 'bun:test';
import { hasTestDb, setup } from './helpers.js';

describe.skipIf(!hasTestDb)('sellers, categories and listings (MySQL)', () => {
  /** @type {Awaited<ReturnType<typeof setup>>} */
  let ctx;
  let request;
  let sharp;
  let DEMO_SPECS;
  let adminToken;
  let sellerToken;
  let sellerId;
  let productId;
  let phonesCategoryId;

  const api = () => request(ctx.app);
  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const png = (w = 900, h = 700) => sharp({ create: { width: w, height: h, channels: 3, background: '#0F4C5C' } }).png().toBuffer();
  const pathOf = (url) => new URL(url).pathname + new URL(url).search;

  beforeAll(async () => {
    ({ default: request } = await import('supertest'));
    ({ default: sharp } = await import('sharp'));
    ({ DEMO_SPECS } = await import('../../src/db/demo/demo-specs.js'));
    ctx = await setup();
    await ctx.reset();
    adminToken = await ctx.makeUser({ phone: '+251911100001', roles: ['buyer', 'bidder', 'super_admin'] });
    sellerToken = await ctx.makeUser({ phone: '+251911100002' });
    phonesCategoryId = (await ctx.prisma.category.findUnique({ where: { slug: 'mobile-phones-tablets' } })).id;
  });
  afterAll(() => ctx?.close());

  // ─── Categories ───
  it('lists the public category tree with Amharic names', async () => {
    const res = await api().get('/api/v1/categories');
    assert.equal(res.status, 200);
    const phones = res.body.data.find((c) => c.slug === 'mobile-phones-tablets');
    assert.ok(phones?.nameAm);
    assert.equal(res.body.data.find((c) => c.slug === 'vehicles').defaultBidFee.etb, '50.00');
  });

  it('lets admins add, rename and remove a category', async () => {
    const created = await api().post('/api/v1/admin/categories').set(auth(adminToken)).send({ slug: 'cameras', nameEn: 'Cameras', nameAm: 'ካሜራዎች', defaultBidFeeEtb: '0' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.data.id;
    assert.equal((await api().patch(`/api/v1/admin/categories/${id}`).set(auth(adminToken)).send({ nameEn: 'Cameras and lenses' })).body.data.nameEn, 'Cameras and lenses');
    assert.equal((await api().delete(`/api/v1/admin/categories/${id}`).set(auth(adminToken))).status, 204);
    assert.equal((await api().post('/api/v1/admin/categories').set(auth(sellerToken)).send({ slug: 'x', nameEn: 'X', nameAm: 'X' })).status, 403);
  });

  // ─── Seller application ───
  it('requires a verified phone to apply', async () => {
    const unverified = await ctx.makeUser({ phone: '+251911100003', roles: ['buyer'], verified: false });
    const res = await api().post('/api/v1/seller/apply').set(auth(unverified)).send({});
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'PHONE_NOT_VERIFIED');
  });

  it('accepts an application and reports missing documents', async () => {
    const res = await api().post('/api/v1/seller/apply').set(auth(sellerToken)).send({
      businessName: 'Bole Mobile Center', businessType: 'INDIVIDUAL', city: 'Addis Ababa',
      payoutMethod: 'TELEBIRR', payoutAccountName: 'Samuel Tadesse', payoutAccountNo: '0911100002',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'PENDING');
    assert.deepEqual(res.body.data.missing, ['IDENTITY_DOCUMENT']);
    assert.equal(res.body.data.payout.accountNo, '+251911100002');
    sellerId = res.body.data.id;

    const again = await api().post('/api/v1/seller/apply').set(auth(sellerToken)).send({
      businessName: 'X', businessType: 'INDIVIDUAL', city: 'Adama', payoutMethod: 'TELEBIRR', payoutAccountName: 'X Y', payoutAccountNo: '0911100002',
    });
    assert.equal(again.body.error.code, 'SELLER_APPLICATION_PENDING');
  });

  it('blocks approval until an ID is uploaded', async () => {
    const res = await api().post(`/api/v1/admin/sellers/${sellerId}/approve`).set(auth(adminToken));
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VERIFICATION_INCOMPLETE');
  });

  it('rejects disguised files and stores a real ID privately', async () => {
    const fake = await api().post('/api/v1/seller/documents').set(auth(sellerToken))
      .field('documentType', 'FAYDA_ID').attach('file', Buffer.from('<?php echo 1; ?> padding padding'), 'id.jpg');
    assert.equal(fake.status, 400);
    assert.equal(fake.body.error.code, 'DOCUMENT_TYPE_NOT_ALLOWED');

    const ok = await api().post('/api/v1/seller/documents').set(auth(sellerToken))
      .field('documentType', 'FAYDA_ID').attach('file', await png(1200, 800), 'fayda.png');
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.data.documents.length, 1);
    assert.equal(ok.body.data.documents[0].url, undefined, 'sellers never get document links back');
    assert.deepEqual(ok.body.data.missing, []);
  });

  it('gives admins a short-lived link to the document', async () => {
    const res = await api().get(`/api/v1/admin/sellers/${sellerId}`).set(auth(adminToken));
    assert.equal(res.status, 200);
    const url = res.body.data.documents[0].url;
    const file = await api().get(pathOf(url));
    assert.equal(file.status, 200);
    assert.equal(file.headers['content-type'], 'image/jpeg');
    assert.equal(file.headers['cache-control'], 'private, no-store');
    const p = pathOf(url);
    const i = p.lastIndexOf('.') + 3; // a character inside the signature
    const tampered = await api().get(p.slice(0, i) + (p[i] === 'A' ? 'B' : 'A') + p.slice(i + 1));
    assert.equal(tampered.status, 404);
  });

  it('approves the seller, grants the role and notifies them', async () => {
    const res = await api().post(`/api/v1/admin/sellers/${sellerId}/approve`).set(auth(adminToken));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'APPROVED');
    sellerToken = await ctx.login('+251911100002'); // new token carries the seller role
    const me = await api().get('/api/v1/me').set(auth(sellerToken));
    assert.ok(me.body.data.roles.includes('seller'));
    const notes = await api().get('/api/v1/notifications').set(auth(sellerToken));
    assert.equal(notes.body.data[0].type, 'SELLER_APPROVED');
    assert.equal(notes.body.meta.unreadCount, 1);
  });

  // ─── Listings ───
  const listing = () => ({
    categoryId: phonesCategoryId, title: 'iPhone 13 128GB, Midnight', condition: 'USED_GOOD', location: 'Hawassa',
    description: 'Battery health 86%. Small scratch on the back glass, screen perfect.', attributes: DEMO_SPECS['iphone-13'],
  });

  it('rejects prices in titles and spec sheets', async () => {
    const res = await api().post('/api/v1/seller/products').set(auth(sellerToken)).send({ ...listing(), title: 'iPhone 13 for 50000 birr' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.details.some((d) => d.path === 'title'));
  });

  it('creates a draft and refuses to submit it without photos', async () => {
    const res = await api().post('/api/v1/seller/products').set(auth(sellerToken)).send(listing());
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'DRAFT');
    assert.equal(res.body.data.highlights.length, 3);
    productId = res.body.data.id;
    const submit = await api().post(`/api/v1/seller/products/${productId}/submit`).set(auth(sellerToken));
    assert.equal(submit.body.error.code, 'PRODUCT_NEEDS_IMAGES');
  });

  it('rejects a whole upload if one file is not a photo', async () => {
    const res = await api().post(`/api/v1/seller/products/${productId}/images`).set(auth(sellerToken))
      .attach('images', await png(), 'a.png').attach('images', Buffer.from('not an image at all, really'), 'b.jpg');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details.fileIndex, 1);
    assert.equal(await ctx.prisma.productImage.count({ where: { productId: BigInt(productId) } }), 0);
  });

  it('stores photos in three sizes and serves them', async () => {
    const res = await api().post(`/api/v1/seller/products/${productId}/images`).set(auth(sellerToken))
      .attach('images', await png(1600, 1200), 'front.png').attach('images', await png(1200, 1200), 'back.png').attach('images', await png(800, 600), 'side.png');
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const images = res.body.data.images;
    assert.equal(images.length, 3);
    for (const size of ['sm', 'md', 'lg']) assert.match(images[0].urls[size], new RegExp(`_${size}\\.webp$`));
    const served = await api().get(pathOf(images[0].urls.md));
    assert.equal(served.status, 200);
    assert.equal(served.headers['content-type'], 'image/webp');
    assert.match(served.headers['cache-control'], /immutable/);
    assert.equal((await api().get('/media/products/1/does-not-exist_sm.webp')).status, 404);
  });

  it('reorders and deletes photos', async () => {
    const before = (await api().get(`/api/v1/seller/products/${productId}`).set(auth(sellerToken))).body.data.images.map((i) => i.id);
    const order = [before[2], before[0], before[1]];
    const res = await api().put(`/api/v1/seller/products/${productId}/images/order`).set(auth(sellerToken)).send({ imageIds: order });
    assert.deepEqual(res.body.data.images.map((i) => i.id), order);
    const del = await api().delete(`/api/v1/seller/products/${productId}/images/${order[2]}`).set(auth(sellerToken));
    assert.equal(del.body.data.images.length, 2);
  });

  it('hides listings from other sellers', async () => {
    const other = await ctx.makeUser({ phone: '+251911100004', roles: ['buyer', 'bidder', 'seller'] });
    const sellerRow = await ctx.prisma.user.findUnique({ where: { phone: '+251911100004' } });
    await ctx.prisma.sellerProfile.create({ data: { userId: sellerRow.id, businessName: 'Other', city: 'Adama', status: 'APPROVED' } });
    const res = await api().get(`/api/v1/seller/products/${productId}`).set(auth(other));
    assert.equal(res.status, 404);
  });

  it('goes through review: submit, reject, fix, approve', async () => {
    assert.equal((await api().post(`/api/v1/seller/products/${productId}/submit`).set(auth(sellerToken))).body.data.status, 'PENDING_REVIEW');

    const queue = await api().get('/api/v1/admin/products?status=PENDING_REVIEW').set(auth(adminToken));
    assert.equal(queue.body.meta.total, 1);

    const rej = await api().post(`/api/v1/admin/products/${productId}/reject`).set(auth(adminToken)).send({ reason: 'Show the scratch in a photo' });
    assert.equal(rej.body.data.status, 'REJECTED');
    assert.equal(rej.body.data.rejectionReason, 'Show the scratch in a photo');

    await api().post(`/api/v1/seller/products/${productId}/images`).set(auth(sellerToken)).attach('images', await png(), 'scratch.png');
    assert.equal((await api().post(`/api/v1/seller/products/${productId}/submit`).set(auth(sellerToken))).body.data.status, 'PENDING_REVIEW');
    const ok = await api().post(`/api/v1/admin/products/${productId}/approve`).set(auth(adminToken));
    assert.equal(ok.body.data.status, 'APPROVED');

    const notes = await api().get('/api/v1/notifications').set(auth(sellerToken));
    assert.deepEqual(notes.body.data.slice(0, 2).map((n) => n.type), ['PRODUCT_APPROVED', 'PRODUCT_REJECTED']);
  });

  it('sends an approved listing back to review when edited', async () => {
    const res = await api().patch(`/api/v1/seller/products/${productId}`).set(auth(sellerToken)).send({ location: 'Hawassa, Piazza' });
    assert.equal(res.body.data.status, 'PENDING_REVIEW');
  });

  it('archives instead of deleting a reviewed listing', async () => {
    const res = await api().delete(`/api/v1/seller/products/${productId}`).set(auth(sellerToken));
    assert.equal(res.body.data.mode, 'archive');
  });

  // ─── Settings ───
  it('validates platform settings and logs changes', async () => {
    const bad = await api().put('/api/v1/admin/settings/fees.commission').set(auth(adminToken))
      .send({ value: { sellerCommissionBp: 20000, buyerPremiumBp: 0, sellerListingFeeMinor: '0', featuredListingFeeMinor: '0' } });
    assert.equal(bad.status, 400);
    const ok = await api().put('/api/v1/admin/settings/listing.rules').set(auth(adminToken)).send({ value: { maxImagesPerProduct: 10, minImagesToSubmit: 2 } });
    assert.equal(ok.status, 200);
    const log = await ctx.prisma.auditLog.findFirst({ where: { action: 'settings.update', entityId: 'listing.rules' } });
    assert.ok(log);
  });
});
