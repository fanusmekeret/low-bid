import assert from 'node:assert/strict';
import { afterAll, beforeAll, describe, it } from 'bun:test';
import { hasTestDb, setup } from './helpers.js';

describe.skipIf(!hasTestDb)('categories and LOW BID listings (MySQL)', () => {
  /** @type {Awaited<ReturnType<typeof setup>>} */
  let ctx;
  let request;
  let sharp;
  let DEMO_SPECS;
  let adminToken;
  let buyerToken;
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
    buyerToken = await ctx.makeUser({ phone: '+251911100002' });
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
    assert.equal((await api().post('/api/v1/admin/categories').set(auth(buyerToken)).send({ slug: 'x', nameEn: 'X', nameAm: 'X' })).status, 403);
  });

  // ─── Seller application ───
  // ─── Listings: written and published by LOW BID staff ───
  const listing = () => ({
    categoryId: phonesCategoryId, title: 'iPhone 13 128GB, Midnight', condition: 'USED_GOOD', location: 'Hawassa',
    description: 'Battery health 86%. Small scratch on the back glass, screen perfect.', attributes: DEMO_SPECS['iphone-13'],
  });

  it('rejects prices in titles and spec sheets', async () => {
    const res = await api().post('/api/v1/admin/products').set(auth(adminToken)).send({ ...listing(), title: 'iPhone 13 for 50000 birr' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.details.some((d) => d.path === 'title'));
  });

  it('keeps listings away from buyers', async () => {
    assert.equal((await api().post('/api/v1/admin/products').set(auth(buyerToken)).send(listing())).status, 403);
    assert.equal((await api().get('/api/v1/seller/products').set(auth(buyerToken))).status, 404, 'there is no seller portal');
  });

  it('creates a draft owned by LOW BID and refuses to publish it without photos', async () => {
    const res = await api().post('/api/v1/admin/products').set(auth(adminToken)).send(listing());
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'DRAFT');
    assert.equal(res.body.data.highlights.length, 3);
    productId = res.body.data.id;
    const row = await ctx.prisma.product.findUnique({ where: { id: BigInt(productId) }, include: { seller: true } });
    assert.equal(row.seller.businessName, 'LOW BID');
    const publish = await api().post(`/api/v1/admin/products/${productId}/publish`).set(auth(adminToken));
    assert.equal(publish.body.error.code, 'PRODUCT_NEEDS_IMAGES');
  });

  it('rejects a whole upload if one file is not a photo', async () => {
    const res = await api().post(`/api/v1/admin/products/${productId}/images`).set(auth(adminToken))
      .attach('images', await png(), 'a.png').attach('images', Buffer.from('not an image at all, really'), 'b.jpg');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details.fileIndex, 1);
    assert.equal(await ctx.prisma.productImage.count({ where: { productId: BigInt(productId) } }), 0);
  });

  it('stores photos in three sizes and serves them', async () => {
    const res = await api().post(`/api/v1/admin/products/${productId}/images`).set(auth(adminToken))
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
    const before = (await api().get(`/api/v1/admin/products/${productId}`).set(auth(adminToken))).body.data.images.map((i) => i.id);
    const order = [before[2], before[0], before[1]];
    const res = await api().put(`/api/v1/admin/products/${productId}/images/order`).set(auth(adminToken)).send({ imageIds: order });
    assert.deepEqual(res.body.data.images.map((i) => i.id), order);
    const del = await api().delete(`/api/v1/admin/products/${productId}/images/${order[2]}`).set(auth(adminToken));
    assert.equal(del.body.data.images.length, 2);
  });

  it('publishes it, keeps it published when edited, and archives instead of deleting', async () => {
    const pub = await api().post(`/api/v1/admin/products/${productId}/publish`).set(auth(adminToken));
    assert.equal(pub.body.data.status, 'APPROVED');
    const edited = await api().patch(`/api/v1/admin/products/${productId}`).set(auth(adminToken)).send({ location: 'Hawassa, Piazza' });
    assert.equal(edited.body.data.status, 'APPROVED');
    const list = await api().get('/api/v1/admin/products?status=APPROVED').set(auth(adminToken));
    assert.ok(list.body.data.some((p) => p.id === productId));
    const res = await api().delete(`/api/v1/admin/products/${productId}`).set(auth(adminToken));
    assert.equal(res.body.data.mode, 'archive');
  });

  // ─── Settings ───
  it('validates platform settings and logs changes', async () => {
    const bad = await api().put('/api/v1/admin/settings/fees').set(auth(adminToken)).send({ value: { buyerPremiumBp: 20000 } });
    assert.equal(bad.status, 400);
    const ok = await api().put('/api/v1/admin/settings/listing.rules').set(auth(adminToken)).send({ value: { maxImagesPerProduct: 10, minImagesToSubmit: 2 } });
    assert.equal(ok.status, 200);
    const log = await ctx.prisma.auditLog.findFirst({ where: { action: 'settings.update', entityId: 'listing.rules' } });
    assert.ok(log);
  });
});
