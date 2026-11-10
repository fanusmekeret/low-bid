import { prisma } from '../../config/prisma.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { etbToMinor } from '../../utils/money.js';
import { recordAudit } from '../audit/audit.service.js';
import { buildCategoryTree, presentCategory } from './categories.tree.js';

const PUBLIC_TTL_MS = 60_000;
let publicCache = null;

export async function publicCategoryTree() {
  if (publicCache && Date.now() - publicCache.at < PUBLIC_TTL_MS) return publicCache.tree;
  const rows = await prisma.category.findMany({ where: { isActive: true } });
  const tree = buildCategoryTree(rows);
  publicCache = { tree, at: Date.now() };
  return tree;
}

export const invalidateCategoryCache = () => { publicCache = null; };

export async function adminCategoryTree() {
  const rows = await prisma.category.findMany({ include: { _count: { select: { products: true } } } });
  return buildCategoryTree(rows);
}

/** Products can only be listed in an active category with no active subcategories. */
export async function assertListableCategory(categoryId, db = prisma) {
  const category = await db.category.findUnique({ where: { id: categoryId }, include: { children: { where: { isActive: true }, select: { id: true } } } });
  if (!category || !category.isActive) throw badRequest('CATEGORY_UNAVAILABLE', 'Choose an active category');
  if (category.children.length) throw badRequest('CATEGORY_NOT_LEAF', 'Choose a more specific category');
  return category;
}

async function checkParent(parentId, selfId) {
  if (parentId === null || parentId === undefined) return;
  if (parentId === selfId) throw badRequest('CATEGORY_PARENT_INVALID', 'A category cannot be its own parent');
  const parent = await prisma.category.findUnique({ where: { id: parentId }, include: { _count: { select: { products: true } } } });
  if (!parent) throw badRequest('CATEGORY_PARENT_INVALID', 'Parent category not found');
  if (parent.parentId !== null) throw badRequest('CATEGORY_TOO_DEEP', 'Categories can only be two levels deep');
  if (parent._count.products > 0) {
    throw conflict('CATEGORY_HAS_PRODUCTS', 'That parent already holds products. Move them before adding subcategories');
  }
}

const toData = (input) => {
  const { defaultBidFeeEtb, ...rest } = input;
  return { ...rest, ...(defaultBidFeeEtb !== undefined && { defaultBidFee: etbToMinor(defaultBidFeeEtb) }) };
};

export async function createCategory(input, { actorId, req }) {
  await checkParent(input.parentId ?? null, undefined);
  const created = await prisma.$transaction(async (tx) => {
    const c = await tx.category.create({ data: toData(input) });
    await recordAudit({ actorId, action: 'category.create', entity: 'category', entityId: c.id, after: c, req }, tx);
    return c;
  });
  invalidateCategoryCache();
  return presentCategory(created);
}

export async function updateCategory(id, input, { actorId, req }) {
  const before = await prisma.category.findUnique({ where: { id }, include: { _count: { select: { children: true } } } });
  if (!before) throw notFound('CATEGORY_NOT_FOUND', 'Category not found');
  if (input.parentId !== undefined && input.parentId !== null) {
    if (before._count.children > 0) throw badRequest('CATEGORY_TOO_DEEP', 'A category with subcategories cannot become a subcategory');
    await checkParent(input.parentId, id);
  }
  const updated = await prisma.$transaction(async (tx) => {
    const c = await tx.category.update({ where: { id }, data: toData(input) });
    await recordAudit({ actorId, action: 'category.update', entity: 'category', entityId: id, before, after: c, req }, tx);
    return c;
  });
  invalidateCategoryCache();
  return presentCategory(updated);
}

export async function deleteCategory(id, { actorId, req }) {
  const c = await prisma.category.findUnique({ where: { id }, include: { _count: { select: { products: true, children: true } } } });
  if (!c) throw notFound('CATEGORY_NOT_FOUND', 'Category not found');
  if (c._count.products || c._count.children) {
    throw conflict('CATEGORY_IN_USE', 'This category has products or subcategories. Deactivate it instead', c._count);
  }
  await prisma.$transaction(async (tx) => {
    await tx.category.delete({ where: { id } });
    await recordAudit({ actorId, action: 'category.delete', entity: 'category', entityId: id, before: c, req }, tx);
  });
  invalidateCategoryCache();
}
