import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { uploadLimiter } from '../../middleware/rateLimit.js';
import { uploadProductImages } from '../../middleware/upload.js';
import { validate } from '../../middleware/validate.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { requireApprovedSeller } from '../sellers/sellers.service.js';
import { adminListQuery, createProductSchema, imageOrderSchema, ownListQuery, reasonSchema, updateProductSchema } from './products.schemas.js';
import * as products from './products.service.js';

const P = PERMISSIONS;
const ctx = (req) => ({ actorId: req.auth.userId, req });
const idParam = z.object({ id: z.coerce.bigint().positive() });
const imageParam = idParam.extend({ imageId: z.coerce.bigint().positive() });

/** Loads the caller's approved seller profile onto req.seller. */
async function loadSeller(req, _res, next) {
  req.seller = await requireApprovedSeller(req.auth.userId);
  next();
}

// ───────────── /api/v1/seller/products ─────────────
export const sellerProductsRouter = Router();
sellerProductsRouter.use(authenticate, requirePermission(P.LISTING_MANAGE), loadSeller);

sellerProductsRouter.get('/', validate({ query: ownListQuery }), async (req, res) => {
  res.json(await products.listOwnProducts(req.seller, req.valid.query));
});

sellerProductsRouter.post('/', validate({ body: createProductSchema }), async (req, res) => {
  res.status(201).json({ data: await products.createProduct(req.seller, req.valid.body, ctx(req)) });
});

sellerProductsRouter.get('/:id', validate({ params: idParam }), async (req, res) => {
  res.json({ data: await products.getOwnProduct(req.seller, req.valid.params.id) });
});

sellerProductsRouter.patch('/:id', validate({ params: idParam, body: updateProductSchema }), async (req, res) => {
  res.json({ data: await products.updateProduct(req.seller, req.valid.params.id, req.valid.body, ctx(req)) });
});

sellerProductsRouter.delete('/:id', validate({ params: idParam }), async (req, res) => {
  res.json({ data: await products.deleteProduct(req.seller, req.valid.params.id, ctx(req)) });
});

// multipart/form-data with up to 10 files in "images"
sellerProductsRouter.post('/:id/images', uploadLimiter, validate({ params: idParam }), uploadProductImages, async (req, res) => {
  res.status(201).json({ data: await products.addImages(req.seller, req.valid.params.id, req.files, ctx(req)) });
});

sellerProductsRouter.put('/:id/images/order', validate({ params: idParam, body: imageOrderSchema }), async (req, res) => {
  res.json({ data: await products.reorderImages(req.seller, req.valid.params.id, req.valid.body.imageIds, ctx(req)) });
});

sellerProductsRouter.delete('/:id/images/:imageId', validate({ params: imageParam }), async (req, res) => {
  res.json({ data: await products.deleteImage(req.seller, req.valid.params.id, req.valid.params.imageId, ctx(req)) });
});

sellerProductsRouter.post('/:id/submit', validate({ params: idParam }), async (req, res) => {
  res.json({ data: await products.submitProduct(req.seller, req.valid.params.id, ctx(req)) });
});

// ───────────── /api/v1/admin/products ─────────────
export const adminProductsRouter = Router();
adminProductsRouter.use(authenticate, requirePermission(P.ADMIN_ACCESS, P.PRODUCT_MANAGE));

adminProductsRouter.get('/', validate({ query: adminListQuery }), async (req, res) => {
  res.json(await products.listProductsAdmin(req.valid.query));
});

adminProductsRouter.get('/:id', validate({ params: idParam }), async (req, res) => {
  res.json({ data: await products.getProductAdmin(req.valid.params.id) });
});

adminProductsRouter.post('/:id/approve', validate({ params: idParam }), async (req, res) => {
  res.json({ data: await products.approveProduct(req.valid.params.id, ctx(req)) });
});

adminProductsRouter.post('/:id/reject', validate({ params: idParam, body: reasonSchema }), async (req, res) => {
  res.json({ data: await products.rejectProduct(req.valid.params.id, req.valid.body.reason, ctx(req)) });
});

adminProductsRouter.post('/:id/archive', validate({ params: idParam, body: reasonSchema }), async (req, res) => {
  res.json({ data: await products.archiveProductAdmin(req.valid.params.id, req.valid.body.reason, ctx(req)) });
});
