import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { uploadLimiter } from '../../middleware/rateLimit.js';
import { uploadProductImages } from '../../middleware/upload.js';
import { validate } from '../../middleware/validate.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { adminListQuery, createProductSchema, imageOrderSchema, reasonSchema, updateProductSchema } from './products.schemas.js';
import * as products from './products.service.js';

// LOW BID writes every listing itself: there is no seller portal. Staff with product:manage
// create a draft, add photos, publish it, and then schedule an auction for it.

const P = PERMISSIONS;
const ctx = (req) => ({ actorId: req.auth.userId, req });
const idParam = z.object({ id: z.coerce.bigint().positive() });
const imageParam = idParam.extend({ imageId: z.coerce.bigint().positive() });

// ───────────── /api/v1/admin/products ─────────────
export const adminProductsRouter = Router();
adminProductsRouter.use(authenticate, requirePermission(P.ADMIN_ACCESS, P.PRODUCT_MANAGE));

adminProductsRouter.get('/', validate({ query: adminListQuery }), async (req, res) => {
  res.json(await products.listProductsAdmin(req.valid.query));
});

adminProductsRouter.post('/', validate({ body: createProductSchema }), async (req, res) => {
  res.status(201).json({ data: await products.createProduct(req.valid.body, ctx(req)) });
});

adminProductsRouter.get('/:id', validate({ params: idParam }), async (req, res) => {
  res.json({ data: await products.getProductAdmin(req.valid.params.id) });
});

adminProductsRouter.patch('/:id', validate({ params: idParam, body: updateProductSchema }), async (req, res) => {
  res.json({ data: await products.updateProduct(req.valid.params.id, req.valid.body, ctx(req)) });
});

adminProductsRouter.delete('/:id', validate({ params: idParam }), async (req, res) => {
  res.json({ data: await products.deleteProduct(req.valid.params.id, ctx(req)) });
});

// multipart/form-data with up to 10 files in "images"
adminProductsRouter.post('/:id/images', uploadLimiter, validate({ params: idParam }), uploadProductImages, async (req, res) => {
  res.status(201).json({ data: await products.addImages(req.valid.params.id, req.files, ctx(req)) });
});

adminProductsRouter.put('/:id/images/order', validate({ params: idParam, body: imageOrderSchema }), async (req, res) => {
  res.json({ data: await products.reorderImages(req.valid.params.id, req.valid.body.imageIds, ctx(req)) });
});

adminProductsRouter.delete('/:id/images/:imageId', validate({ params: imageParam }), async (req, res) => {
  res.json({ data: await products.deleteImage(req.valid.params.id, req.valid.params.imageId, ctx(req)) });
});

adminProductsRouter.post('/:id/publish', validate({ params: idParam }), async (req, res) => {
  res.json({ data: await products.publishProduct(req.valid.params.id, ctx(req)) });
});

adminProductsRouter.post('/:id/archive', validate({ params: idParam, body: reasonSchema }), async (req, res) => {
  res.json({ data: await products.archiveProductAdmin(req.valid.params.id, req.valid.body.reason, ctx(req)) });
});
