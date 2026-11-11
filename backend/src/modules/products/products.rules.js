// Pure product rules (no database), shared by the service and the tests.

/** Auctions in these states freeze the product: buyers are bidding on exactly what they saw. */
const LOCKING_AUCTION_STATUSES = new Set(['SCHEDULED', 'LIVE']);

/**
 * @param {{ status: string, auctions?: { status: string, result?: { outcome: string } | null }[] }} product
 * @returns {null | { code: string, message: string }} why the product cannot be edited, or null
 */
export function editLock(product) {
  if (product.status === 'ARCHIVED') return { code: 'PRODUCT_ARCHIVED', message: 'This listing is archived' };
  for (const a of product.auctions ?? []) {
    if (LOCKING_AUCTION_STATUSES.has(a.status)) {
      return { code: 'PRODUCT_LOCKED', message: 'This listing has a scheduled or live auction and cannot be changed' };
    }
    if (a.status === 'CLOSED' && a.result?.outcome === 'SOLD') {
      return { code: 'PRODUCT_SOLD', message: 'This item has been sold and cannot be changed' };
    }
  }
  return null;
}

/**
 * Only drafts are published, and only with enough photos.
 * @returns {null | { code: string, message: string, details?: object }}
 */
export function publishBlocker(product, { imageCount, minImages }) {
  if (product.status !== 'DRAFT') {
    return { code: 'PRODUCT_NOT_DRAFT', message: `This listing is ${product.status.toLowerCase()}, not a draft` };
  }
  if (imageCount < minImages) {
    return { code: 'PRODUCT_NEEDS_IMAGES', message: `Add at least ${minImages} photo${minImages > 1 ? 's' : ''} first`, details: { imageCount, minImages } };
  }
  return null;
}

/** Only drafts with no auction history are deleted; anything else is archived to keep records. */
export const deleteMode = (product) => ((product.auctions ?? []).length === 0 && product.status === 'DRAFT' ? 'delete' : 'archive');

/** New order must name every image exactly once. */
export function validImageOrder(existingIds, requestedIds) {
  if (existingIds.length !== requestedIds.length) return false;
  const want = new Set(requestedIds.map(String));
  return want.size === requestedIds.length && existingIds.every((id) => want.has(String(id)));
}
