import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requirePermission, requireVerifiedPhone } from '../../middleware/auth.js';
import { uploadLimiter } from '../../middleware/rateLimit.js';
import { uploadDocument } from '../../middleware/upload.js';
import { validate } from '../../middleware/validate.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { adminListQuery, applySchema, documentTypeSchema, reasonSchema, updateProfileSchema } from './sellers.schemas.js';
import * as sellers from './sellers.service.js';

const P = PERMISSIONS;
const ctx = (req) => ({ actorId: req.auth.userId, req });

// ───────────── /api/v1/seller — the signed-in user's own seller account ─────────────
export const sellerRouter = Router();
sellerRouter.use(authenticate);

sellerRouter.post('/apply', requirePermission(P.SELLER_APPLY), requireVerifiedPhone, validate({ body: applySchema }), async (req, res) => {
  res.status(201).json({ data: await sellers.applyAsSeller(req.auth.userId, req.valid.body, ctx(req)) });
});

sellerRouter.get('/profile', async (req, res) => {
  res.json({ data: await sellers.getOwnSellerProfile(req.auth.userId) });
});

sellerRouter.patch('/profile', validate({ body: updateProfileSchema }), async (req, res) => {
  res.json({ data: await sellers.updateOwnSellerProfile(req.auth.userId, req.valid.body, ctx(req)) });
});

// multipart/form-data: documentType=FAYDA_ID, file=<image or PDF>
sellerRouter.post('/documents', uploadLimiter, uploadDocument, validate({ body: documentTypeSchema }), async (req, res) => {
  const data = await sellers.addVerificationDocument(req.auth.userId, { documentType: req.valid.body.documentType, file: req.file }, ctx(req));
  res.status(201).json({ data });
});

sellerRouter.delete('/documents/:id', validate({ params: z.object({ id: z.coerce.bigint().positive() }) }), async (req, res) => {
  res.json({ data: await sellers.removeVerificationDocument(req.auth.userId, req.valid.params.id) });
});

// ───────────── /api/v1/admin/sellers ─────────────
const idParam = z.object({ id: z.coerce.bigint().positive() });

export const adminSellersRouter = Router();
adminSellersRouter.use(authenticate, requirePermission(P.ADMIN_ACCESS, P.SELLER_REVIEW));

adminSellersRouter.get('/', validate({ query: adminListQuery }), async (req, res) => {
  res.json(await sellers.listSellers(req.valid.query));
});

adminSellersRouter.get('/:id', validate({ params: idParam }), async (req, res) => {
  const canSeePayout = req.auth.permissions.has(P.PAYOUT_MANAGE);
  res.json({ data: await sellers.getSellerForAdmin(req.valid.params.id, { canSeePayout }) });
});

adminSellersRouter.post('/:id/approve', validate({ params: idParam }), async (req, res) => {
  await sellers.approveSeller(req.valid.params.id, ctx(req));
  res.json({ data: await sellers.getSellerForAdmin(req.valid.params.id, { canSeePayout: false }) });
});

adminSellersRouter.post('/:id/reject', validate({ params: idParam, body: reasonSchema }), async (req, res) => {
  await sellers.rejectSeller(req.valid.params.id, req.valid.body.reason, ctx(req));
  res.json({ data: await sellers.getSellerForAdmin(req.valid.params.id, { canSeePayout: false }) });
});

adminSellersRouter.post('/:id/suspend', requirePermission(P.USER_MANAGE), validate({ params: idParam, body: reasonSchema }), async (req, res) => {
  await sellers.suspendSeller(req.valid.params.id, req.valid.body.reason, ctx(req));
  res.json({ data: await sellers.getSellerForAdmin(req.valid.params.id, { canSeePayout: false }) });
});

adminSellersRouter.post('/:id/reinstate', requirePermission(P.USER_MANAGE), validate({ params: idParam }), async (req, res) => {
  await sellers.reinstateSeller(req.valid.params.id, ctx(req));
  res.json({ data: await sellers.getSellerForAdmin(req.valid.params.id, { canSeePayout: false }) });
});
