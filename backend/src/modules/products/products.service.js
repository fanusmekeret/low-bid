import { prisma } from '../../config/prisma.js';
import { deleteProductImageFiles, storeProductImages } from '../../services/media/productImages.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { recordAudit } from '../audit/audit.service.js';
import { assertListableCategory } from '../categories/categories.service.js';
import { getHouseSeller } from '../house/house.service.js';
import { getSetting } from '../settings/settings.service.js';
import { presentProduct } from './products.presenter.js';
import { deleteMode, editLock, publishBlocker, validImageOrder } from './products.rules.js';

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


function assertEditable(p) {
  const lock = editLock(p);
  if (lock) throw conflict(lock.code, lock.message);
}

const reload = async (id) => presentProduct(await prisma.product.findUniqueOrThrow({ where: { id: BigInt(id) }, include: FULL }));

// Listings are written by LOW BID staff (permission product:manage). A listing is a DRAFT until
// it is published; only published (APPROVED) listings can be auctioned.

export async function createProduct(input, { actorId, req }) {
  await assertListableCategory(input.categoryId);
  const seller = await getHouseSeller();
  const p = await prisma.$transaction(async (tx) => {
    const created = await tx.product.create({ data: { ...input, sellerId: seller.id, status: 'DRAFT' } });
    await recordAudit({ actorId, action: 'product.create', entity: 'product', entityId: created.id, req }, tx);
    return created;
  });
  return reload(p.id);
}

export async function updateProduct(id, input, { actorId, req }) {
  if (input.categoryId !== undefined) await assertListableCategory(input.categoryId);
  await prisma.$transaction(async (tx) => {
    const p = await lockProduct(tx, id);
    assertEditable(p);
    await tx.product.update({ where: { id: p.id }, data: input });
    await recordAudit({ actorId, action: 'product.update', entity: 'product', entityId: p.id, after: { fields: Object.keys(input) }, req }, tx);
  });
  return reload(id);
}

export async function deleteProduct(id, { actorId, req }) {
  let removedKeys = [];
  const mode = await prisma.$transaction(async (tx) => {
    const p = await lockProduct(tx, id);
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

export async function addImages(id, files, { actorId, req }) {
  if (!files?.length) throw badRequest('FILES_REQUIRED', 'Attach photos in the "images" field');
  const { maxImagesPerProduct } = await getSetting('listing.rules');

  // Quick check before the slow image work; re-checked under the row lock below.
  const current = await prisma.product.findUnique({ where: { id: BigInt(id) }, include: { auctions: { include: { result: true } }, _count: { select: { images: true } } } });
  if (!current) throw notFound('PRODUCT_NOT_FOUND', 'Listing not found');
  assertEditable(current);
  if (current._count.images + files.length > maxImagesPerProduct) {
    throw badRequest('TOO_MANY_IMAGES', `A listing can have up to ${maxImagesPerProduct} photos`, { current: current._count.images, max: maxImagesPerProduct });
  }

  const stored = await storeProductImages(current.id, files);
  try {
    await prisma.$transaction(async (tx) => {
      const p = await lockProduct(tx, id);
      assertEditable(p);
      if (p.images.length + stored.length > maxImagesPerProduct) {
        throw badRequest('TOO_MANY_IMAGES', `A listing can have up to ${maxImagesPerProduct} photos`, { current: p.images.length, max: maxImagesPerProduct });
      }
      const nextOrder = p.images.reduce((m, i) => Math.max(m, i.sortOrder + 1), 0);
      await tx.productImage.createMany({ data: stored.map((s, i) => ({ productId: p.id, key: s.key, width: s.width, height: s.height, sortOrder: nextOrder + i })) });
      await recordAudit({ actorId, action: 'product.images_add', entity: 'product', entityId: p.id, after: { count: stored.length }, req }, tx);
    });
  } catch (err) {
    await deleteProductImageFiles(stored.map((s) => s.key)).catch(() => {});
    throw err;
  }
  return reload(id);
}

export async function reorderImages(id, imageIds, { actorId, req }) {
  await prisma.$transaction(async (tx) => {
    const p = await lockProduct(tx, id);
    assertEditable(p);
    if (!validImageOrder(p.images.map((i) => i.id), imageIds)) {
      throw badRequest('IMAGE_ORDER_INVALID', 'List every photo of this listing exactly once');
    }
    for (const [i, imageId] of imageIds.entries()) await tx.productImage.update({ where: { id: imageId }, data: { sortOrder: i } });
    await recordAudit({ actorId, action: 'product.images_reorder', entity: 'product', entityId: p.id, req }, tx);
  });
  return reload(id);
}

export async function deleteImage(id, imageId, { actorId, req }) {
  let key;
  await prisma.$transaction(async (tx) => {
    const p = await lockProduct(tx, id);
    assertEditable(p);
    const img = p.images.find((i) => i.id === BigInt(imageId));
    if (!img) throw notFound('IMAGE_NOT_FOUND', 'Photo not found');
    key = img.key;
    await tx.productImage.delete({ where: { id: img.id } });
    await recordAudit({ actorId, action: 'product.image_delete', entity: 'product', entityId: p.id, req }, tx);
  });
  await deleteProductImageFiles([key]).catch((err) => logger.warn({ err }, 'image cleanup failed'));
  return reload(id);
}

/** Publishes a draft: it needs photos and a listable category. Published listings can be auctioned. */
export async function publishProduct(id, { actorId, req }) {
  const { minImagesToSubmit } = await getSetting('listing.rules');
  await prisma.$transaction(async (tx) => {
    const p = await lockProduct(tx, id);
    assertEditable(p);
    const blocker = publishBlocker(p, { imageCount: p.images.length, minImages: minImagesToSubmit });
    if (blocker) throw badRequest(blocker.code, blocker.message, blocker.details);
    await assertListableCategory(p.categoryId, tx);
    await tx.product.update({ where: { id: p.id }, data: { status: 'APPROVED', rejectionReason: null } });
    await recordAudit({ actorId, action: 'product.publish', entity: 'product', entityId: p.id, req }, tx);
  });
  return reload(id);
}

// ───────────────────────────── Lists ─────────────────────────────

export async function listProductsAdmin({ status, categoryId, q, page, pageSize }) {
  const where = {
    ...(status ? { status } : { status: { not: 'ARCHIVED' } }),
    ...(categoryId && { categoryId }),
    ...(q && { title: { contains: q } }),
  };
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

export async function getProductAdmin(id) {
  const p = await prisma.product.findUnique({ where: { id: BigInt(id) }, include: FULL });
  if (!p) throw notFound('PRODUCT_NOT_FOUND', 'Listing not found');
  return presentProduct(p);
}

export async function archiveProductAdmin(id, reason, { actorId, req }) {
  await prisma.$transaction(async (tx) => {
    const p = await lockProduct(tx, id);
    if (p.auctions.some((a) => ['SCHEDULED', 'LIVE'].includes(a.status))) {
      throw conflict('PRODUCT_HAS_ACTIVE_AUCTION', 'Cancel the scheduled or live auction first');
    }
    await tx.product.update({ where: { id: p.id }, data: { status: 'ARCHIVED', rejectionReason: reason } });
    await recordAudit({ actorId, action: 'product.admin_archive', entity: 'product', entityId: p.id, after: { reason }, req }, tx);
  });
  return getProductAdmin(id);
}
