import { moneyDto } from '../../utils/money.js';

export function presentCategory(c) {
  return {
    id: c.id,
    slug: c.slug,
    nameEn: c.nameEn,
    nameAm: c.nameAm,
    iconKey: c.iconKey,
    sortOrder: c.sortOrder,
    isActive: c.isActive,
    defaultBidFee: moneyDto(c.defaultBidFee ?? 0n), // 0 = platform default
    parentId: c.parentId,
    ...(c._count ? { productCount: c._count.products } : {}),
  };
}

/** Flat rows → two-level tree, ordered by sortOrder then English name. Orphans become roots. */
export function buildCategoryTree(rows) {
  const order = (a, b) => a.sortOrder - b.sortOrder || a.nameEn.localeCompare(b.nameEn);
  const ids = new Set(rows.map((r) => r.id));
  const nodes = new Map(rows.map((r) => [r.id, { ...presentCategory(r), children: [] }]));
  const roots = [];
  for (const r of [...rows].sort(order)) {
    const node = nodes.get(r.id);
    if (r.parentId !== null && ids.has(r.parentId)) nodes.get(r.parentId).children.push(node);
    else roots.push(node);
  }
  return roots;
}
