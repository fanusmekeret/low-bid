import { imageUrls } from '../../services/media/productImages.js';
import { editLock } from './products.rules.js';

/** Product shape for its seller and for admins (not the public auction views). */
export function presentProduct(p) {
  const lock = editLock(p);
  const attrs = p.attributes ?? {};
  return {
    id: p.id.toString(),
    status: p.status,
    rejectionReason: p.rejectionReason,
    title: p.title,
    description: p.description,
    condition: p.condition,
    location: p.location,
    highlights: attrs.highlights ?? [],
    specs: attrs.specs ?? [],
    category: p.category ? { id: p.category.id, slug: p.category.slug, nameEn: p.category.nameEn, nameAm: p.category.nameAm } : { id: p.categoryId },
    images: (p.images ?? []).map((img) => ({ id: img.id.toString(), width: img.width, height: img.height, sortOrder: img.sortOrder, urls: imageUrls(img.key) })),
    auctions: (p.auctions ?? []).map((a) => ({ id: a.id.toString(), status: a.status, startsAt: a.startsAt, endsAt: a.endsAt, outcome: a.result?.outcome ?? null })),
    editable: lock === null,
    lockedReason: lock?.code ?? null,
    seller: p.seller ? { id: p.seller.id.toString(), businessName: p.seller.businessName, status: p.seller.status } : undefined,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}
