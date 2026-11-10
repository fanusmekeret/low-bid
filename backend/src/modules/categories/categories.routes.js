import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { adminCategoryTree, createCategory, deleteCategory, publicCategoryTree, updateCategory } from './categories.service.js';

// ─── Public ───
export const categoriesRouter = Router();

categoriesRouter.get('/', async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ data: await publicCategoryTree() });
});

// ─── Admin ───
const etb = z.string().trim().regex(/^\d{1,13}(\.\d{1,2})?$/, 'Amount in ETB, e.g. 50 or 50.00');
const fields = {
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, numbers and dashes').max(100),
  nameEn: z.string().trim().min(1).max(100),
  nameAm: z.string().trim().min(1).max(100),
  parentId: z.number().int().positive().nullable(),
  iconKey: z.string().trim().regex(/^[a-z0-9_]{1,60}$/).nullable(),
  sortOrder: z.number().int().min(0).max(10_000),
  isActive: z.boolean(),
  defaultBidFeeEtb: etb,
};
const createSchema = z.object(fields).partial({ parentId: true, iconKey: true, sortOrder: true, isActive: true, defaultBidFeeEtb: true });
const updateSchema = z.object(fields).partial().refine((v) => Object.keys(v).length > 0, 'Nothing to update');
const idParam = z.object({ id: z.coerce.number().int().positive() });
const ctx = (req) => ({ actorId: req.auth.userId, req });

export const adminCategoriesRouter = Router();
adminCategoriesRouter.use(authenticate, requirePermission(PERMISSIONS.ADMIN_ACCESS, PERMISSIONS.CATEGORY_MANAGE));

adminCategoriesRouter.get('/', async (_req, res) => {
  res.json({ data: await adminCategoryTree() });
});

adminCategoriesRouter.post('/', validate({ body: createSchema }), async (req, res) => {
  res.status(201).json({ data: await createCategory(req.valid.body, ctx(req)) });
});

adminCategoriesRouter.patch('/:id', validate({ params: idParam, body: updateSchema }), async (req, res) => {
  res.json({ data: await updateCategory(req.valid.params.id, req.valid.body, ctx(req)) });
});

adminCategoriesRouter.delete('/:id', validate({ params: idParam }), async (req, res) => {
  await deleteCategory(req.valid.params.id, ctx(req));
  res.status(204).end();
});
