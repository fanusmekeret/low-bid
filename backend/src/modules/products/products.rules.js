// Pure product rules (no database), shared by the service and the tests.

/** Auctions in these states freeze the product: buyers are bidding on exactly what they saw. */
const LOCKING_AUCTION_STATUSES = new Set(['PENDING_APPROVAL', 'SCHEDULED', 'LIVE']);

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
 * Editing an approved listing sends it back for review, so a seller cannot get a listing
 * approved and then swap the item or the photos.
 */
export const statusAfterEdit = (status) => (status === 'APPROVED' ? 'PENDING_REVIEW' : status);

/**
 * @returns {null | { code: string, message: string, details?: object }}
 */
export function submitBlocker(product, { imageCount, minImages }) {
  if (!['DRAFT', 'REJECTED'].includes(product.status)) {
    return { code: 'PRODUCT_NOT_SUBMITTABLE', message: `A ${product.status.toLowerCase().replace('_', ' ')} listing cannot be submitted` };
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
