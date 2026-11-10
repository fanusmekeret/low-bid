import { prisma } from '../../config/prisma.js';
import { deleteProductImageFiles, storeProductImages } from '../../services/media/productImages.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { recordAudit } from '../audit/audit.service.js';
import { assertListableCategory } from '../categories/categories.service.js';
import { notify } from '../notifications/notifications.service.js';
import { getSetting } from '../settings/settings.service.js';
import { presentProduct } from './products.presenter.js';
import { deleteMode, editLock, statusAfterEdit, submitBlocker, validImageOrder } from './products.rules.js';

const FULL = {
  category: true,
  images: { orderBy: { sortOrder: 'asc' } },
  auctions: { orderBy: { createdAt: 'desc' }, include: { result: { select: { outcome: true } } } },
  seller: true,
};

/** Locks the product row for the rest of the transaction (images, status changes). */
async function lockProduct(tx, id) {
  const rows = await tx.$queryRaw`SELECT id FROM products WHERE id = ${BigInt(id)} FOR UPDATE`;
  if (!rows.length) throw notFound('PRODUCT_NOT_FOUND', 'Listing not found');
  return tx.product.findUnique({ where: { id: BigInt(id) }, include: FULL });
}

async function ownProduct(tx, seller, id) {
  const p = await lockProduct(tx, id);
  // Same error as "not found" so sellers cannot probe other sellers' listings.
  if (p.sellerId !== seller.id) throw notFound('PRODUCT_NOT_FOUND', 'Listing not found');
  return p;
}

function assertEditable(p) {
  const lock = editLock(p);
  if (lock) throw conflict(lock.code, lock.message);
}

const reload = async (id) => presentProduct(await prisma.product.findUniqueOrThrow({ where: { id: BigInt(id) }, include: FULL }));

// ───────────────────────────── Seller side ─────────────────────────────

export async function listOwnProducts(seller, { status, page, pageSize }) {
  const where = { sellerId: seller.id, ...(status && { status }), ...(!status && { status: { not: 'ARCHIVED' } }) };
  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { ...FULL, images: { orderBy: { sortOrder: 'asc' }, take: 1 } },
    }),
  ]);
  return { data: rows.map(presentProduct), meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}

export async function getOwnProduct(seller, id) {
  const p = await prisma.product.findUnique({ where: { id: BigInt(id) }, include: FULL });
  if (!p || p.sellerId !== seller.id) throw notFound('PRODUCT_NOT_FOUND', 'Listing not found');
  return presentProduct(p);
}

export async function createProduct(seller, input, { actorId, req }) {
  await assertListableCategory(input.categoryId);
  const p = await prisma.$transaction(async (tx) => {
    const created = await tx.product.create({ data: { ...input, sellerId: seller.id, status: 'DRAFT' } });
    await recordAudit({ actorId, action: 'product.create', entity: 'product', entityId: created.id, req }, tx);
    return created;
  });
  return reload(p.id);
}

export async function updateProduct(seller, id, input, { actorId, req }) {
  if (input.categoryId !== undefined) await assertListableCategory(input.categoryId);
  await prisma.$transaction(async (tx) => {
    const p = await ownProduct(tx, seller, id);
    assertEditable(p);
    const status = statusAfterEdit(p.status);
    await tx.product.update({ where: { id: p.id }, data: { ...input, status, ...(status !== p.status && { rejectionReason: null }) } });
    await recordAudit({
      actorId, action: 'product.update', entity: 'product', entityId: p.id,
      before: { status: p.status }, after: { status, fields: Object.keys(input) }, req,
    }, tx);
  });
  return reload(id);
}

export async function deleteProduct(seller, id, { actorId, req }) {
  let removedKeys = [];
  const mode = await prisma.$transaction(async (tx) => {
    const p = await ownProduct(tx, seller, id);
    assertEditable(p);
    const m = deleteMode(p);
    if (m === 'delete') {
      removedKeys = p.images.map((i) => i.key);
      await tx.product.delete({ where: { id: p.id } }); // image rows cascade
    } else {
      await tx.product.update({ where: { id: p.id }, data: { status: 'ARCHIVED' } });
    }
    await recordAudit({ actorId, action: m === 'delete' ? 'product.delete' : 'product.archive', entity: 'product', entityId: p.id, req }, tx);
    return m;
  });
  await deleteProductImageFiles(removedKeys).catch((err) => logger.warn({ err }, 'image cleanup failed'));
  return { mode };
}

export async function addImages(seller, id, files, { actorId, req }) {
  if (!files?.length) throw badRequest('FILES_REQUIRED', 'Attach photos in the "images" field');
  const { maxImagesPerProduct } = await getSetting('listing.rules');

  // Quick check before the slow image work; re-checked under the row lock below.
  const current = await prisma.product.findUnique({ where: { id: BigInt(id) }, include: { auctions: { include: { result: true } }, _count: { select: { images: true } } } });
  if (!current || current.sellerId !== seller.id) throw notFound('PRODUCT_NOT_FOUND', 'Listing not found');
  assertEditable(current);
  if (current._count.images + files.length > maxImagesPerProduct) {
    throw badRequest('TOO_MANY_IMAGES', `A listing can have up to ${maxImagesPerProduct} photos`, { current: current._count.images, max: maxImagesPerProduct });
  }

  const stored = await storeProductImages(current.id, files);
  try {
    await prisma.$transaction(async (tx) => {
      const p = await ownProduct(tx, seller, id);
      assertEditable(p);
      if (p.images.length + stored.length > maxImagesPerProduct) {
        throw badRequest('TOO_MANY_IMAGES', `A listing can have up to ${maxImagesPerProduct} photos`, { current: p.images.length, max: maxImagesPerProduct });
      }
      const nextOrder = p.images.reduce((m, i) => Math.max(m, i.sortOrder + 1), 0);
      await tx.productImage.createMany({ data: stored.map((s, i) => ({ productId: p.id, key: s.key, width: s.width, height: s.height, sortOrder: nextOrder + i })) });
      const status = statusAfterEdit(p.status);
      if (status !== p.status) await tx.product.update({ where: { id: p.id }, data: { status } });
      await recordAudit({ actorId, action: 'product.images_add', entity: 'product', entityId: p.id, after: { count: stored.length }, req }, tx);
    });
  } catch (err) {
    await deleteProductImageFiles(stored.map((s) => s.key)).catch(() => {});
    throw err;
  }
  return reload(id);
}

export async function reorderImages(seller, id, imageIds, { actorId, req }) {
  await prisma.$transaction(async (tx) => {
    const p = await ownProduct(tx, seller, id);
    assertEditable(p);
    if (!validImageOrder(p.images.map((i) => i.id), imageIds)) {
      throw badRequest('IMAGE_ORDER_INVALID', 'List every photo of this listing exactly once');
    }
    for (const [i, imageId] of imageIds.entries()) await tx.productImage.update({ where: { id: imageId }, data: { sortOrder: i } });
    await recordAudit({ actorId, action: 'product.images_reorder', entity: 'product', entityId: p.id, req }, tx);
  });
  return reload(id);
}

export async function deleteImage(seller, id, imageId, { actorId, req }) {
  let key;
  await prisma.$transaction(async (tx) => {
    const p = await ownProduct(tx, seller, id);
    assertEditable(p);
    const img = p.images.find((i) => i.id === BigInt(imageId));
    if (!img) throw notFound('IMAGE_NOT_FOUND', 'Photo not found');
    key = img.key;
    await tx.productImage.delete({ where: { id: img.id } });
    const status = statusAfterEdit(p.status);
    if (status !== p.status) await tx.product.update({ where: { id: p.id }, data: { status } });
    await recordAudit({ actorId, action: 'product.image_delete', entity: 'product', entityId: p.id, req }, tx);
  });
  await deleteProductImageFiles([key]).catch((err) => logger.warn({ err }, 'image cleanup failed'));
  return reload(id);
}

export async function submitProduct(seller, id, { actorId, req }) {
  const { minImagesToSubmit } = await getSetting('listing.rules');
  await prisma.$transaction(async (tx) => {
    const p = await ownProduct(tx, seller, id);
    assertEditable(p);
    const blocker = submitBlocker(p, { imageCount: p.images.length, minImages: minImagesToSubmit });
    if (blocker) throw badRequest(blocker.code, blocker.message, blocker.details);
    await assertListableCategory(p.categoryId, tx);
    await tx.product.update({ where: { id: p.id }, data: { status: 'PENDING_REVIEW', rejectionReason: null } });
    await recordAudit({ actorId, action: 'product.submit', entity: 'product', entityId: p.id, req }, tx);
  });
  return reload(id);
}

// ───────────────────────────── Admin side ─────────────────────────────

export async function listProductsAdmin({ status, categoryId, sellerId, q, page, pageSize }) {
  const where = {
    ...(status && { status }),
    ...(categoryId && { categoryId }),
    ...(sellerId && { sellerId }),
    ...(q && { OR: [{ title: { contains: q } }, { seller: { businessName: { contains: q } } }] }),
  };
  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      // The review queue is oldest first.
      orderBy: status === 'PENDING_REVIEW' ? { updatedAt: 'asc' } : { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { ...FULL, images: { orderBy: { sortOrder: 'asc' }, take: 1 } },
    }),
  ]);
  return { data: rows.map(presentProduct), meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}

export async function getProductAdmin(id) {
  const p = await prisma.product.findUnique({ where: { id: BigInt(id) }, include: FULL });
  if (!p) throw notFound('PRODUCT_NOT_FOUND', 'Listing not found');
  return presentProduct(p);
}

async function review(id, { actorId, req }, decide) {
  await prisma.$transaction(async (tx) => {
    const p = await lockProduct(tx, id);
    if (p.status !== 'PENDING_REVIEW') throw conflict('PRODUCT_NOT_PENDING', `This listing is ${p.status.toLowerCase().replace('_', ' ')}, not waiting for review`);
    await decide(tx, p);
  });
  return getProductAdmin(id);
}

export const approveProduct = (id, ctx) => review(id, ctx, async (tx, p) => {
  if (p.seller.status !== 'APPROVED') throw conflict('SELLER_NOT_APPROVED', 'The seller of this listing is not approved');
  await tx.product.update({ where: { id: p.id }, data: { status: 'APPROVED', rejectionReason: null } });
  await notify(p.seller.userId, 'PRODUCT_APPROVED', { title: p.title }, { productId: p.id }, tx);
  await recordAudit({ actorId: ctx.actorId, action: 'product.approve', entity: 'product', entityId: p.id, req: ctx.req }, tx);
});

export const rejectProduct = (id, reason, ctx) => review(id, ctx, async (tx, p) => {
  await tx.product.update({ where: { id: p.id }, data: { status: 'REJECTED', rejectionReason: reason } });
  await notify(p.seller.userId, 'PRODUCT_REJECTED', { title: p.title, reason }, { productId: p.id }, tx);
  await recordAudit({ actorId: ctx.actorId, action: 'product.reject', entity: 'product', entityId: p.id, after: { reason }, req: ctx.req }, tx);
});

export async function archiveProductAdmin(id, reason, { actorId, req }) {
  await prisma.$transaction(async (tx) => {
    const p = await lockProduct(tx, id);
    if (p.auctions.some((a) => ['SCHEDULED', 'LIVE', 'PENDING_APPROVAL'].includes(a.status))) {
      throw conflict('PRODUCT_HAS_ACTIVE_AUCTION', 'Cancel the scheduled or live auction first');
    }
    await tx.product.update({ where: { id: p.id }, data: { status: 'ARCHIVED', rejectionReason: reason } });
    await notify(p.seller.userId, 'PRODUCT_REJECTED', { title: p.title, reason }, { productId: p.id }, tx);
    await recordAudit({ actorId, action: 'product.admin_archive', entity: 'product', entityId: p.id, after: { reason }, req }, tx);
  });
  return getProductAdmin(id);
}
