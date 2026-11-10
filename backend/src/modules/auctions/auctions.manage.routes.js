import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { requireApprovedSeller } from '../sellers/sellers.service.js';
import { adminBidsQuery, adminListQuery, adminPatchSchema, createAuctionSchema, reasonSchema, sellerListQuery } from './auctions.schemas.js';
import * as manage from './auctions.manage.service.js';

const P = PERMISSIONS;
const ctx = (req) => ({ actorId: req.auth.userId, req });
const idParam = z.object({ id: z.coerce.bigint().positive() });

// ───────────── /api/v1/seller/auctions ─────────────
export const sellerAuctionsRouter = Router();
sellerAuctionsRouter.use(authenticate, requirePermission(P.AUCTION_CREATE), async (req, _res, next) => {
  req.seller = await requireApprovedSeller(req.auth.userId);
  next();
});

sellerAuctionsRouter.get('/', validate({ query: sellerListQuery }), async (req, res) => {
  res.json(await manage.listSellerAuctions(req.seller, req.valid.query));
});

sellerAuctionsRouter.post('/', validate({ body: createAuctionSchema }), async (req, res) => {
  res.status(201).json({ data: await manage.createAuction(req.seller, req.valid.body, ctx(req)) });
});

sellerAuctionsRouter.get('/:id', validate({ params: idParam }), async (req, res) => {
  res.json({ data: await manage.getSellerAuction(req.seller, req.valid.params.id) });
});

sellerAuctionsRouter.post('/:id/cancel', validate({ params: idParam, body: reasonSchema }), async (req, res) => {
  res.json({ data: await manage.cancelSellerAuction(req.seller, req.valid.params.id, req.valid.body.reason, ctx(req)) });
});

// ───────────── /api/v1/admin/auctions and /api/v1/admin/bids ─────────────
export const adminAuctionsRouter = Router();
adminAuctionsRouter.use(authenticate, requirePermission(P.ADMIN_ACCESS));

adminAuctionsRouter.get('/', requirePermission(P.AUCTION_REVIEW), validate({ query: adminListQuery }), async (req, res) => {
  res.json(await manage.listAuctionsAdmin(req.valid.query));
});

adminAuctionsRouter.get('/:id', requirePermission(P.AUCTION_REVIEW), validate({ params: idParam }), async (req, res) => {
  res.json({ data: await manage.getAuctionManaged(req.valid.params.id, { withSellerContact: true }) });
});

adminAuctionsRouter.post('/:id/approve', requirePermission(P.AUCTION_REVIEW), validate({ params: idParam }), async (req, res) => {
  res.json({ data: await manage.approveAuction(req.valid.params.id, ctx(req)) });
});

adminAuctionsRouter.post('/:id/reject', requirePermission(P.AUCTION_REVIEW), validate({ params: idParam, body: reasonSchema }), async (req, res) => {
  res.json({ data: await manage.rejectAuction(req.valid.params.id, req.valid.body.reason, ctx(req)) });
});

adminAuctionsRouter.post('/:id/cancel', requirePermission(P.AUCTION_CANCEL), validate({ params: idParam, body: reasonSchema }), async (req, res) => {
  res.json({ data: await manage.cancelAuctionAdmin(req.valid.params.id, req.valid.body.reason, ctx(req)) });
});

adminAuctionsRouter.patch('/:id', requirePermission(P.AUCTION_REVIEW), validate({ params: idParam, body: adminPatchSchema }), async (req, res) => {
  res.json({ data: await manage.patchAuctionAdmin(req.valid.params.id, req.valid.body, ctx(req)) });
});

export const adminBidsRouter = Router();
adminBidsRouter.use(authenticate, requirePermission(P.ADMIN_ACCESS, P.BID_MONITOR));

adminBidsRouter.get('/', validate({ query: adminBidsQuery }), async (req, res) => {
  res.json(await manage.listBidsAdmin(req.valid.query));
});
