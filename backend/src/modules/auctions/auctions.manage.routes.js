import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { adminBidsQuery, adminListQuery, adminPatchSchema, createAuctionSchema, reasonSchema } from './auctions.schemas.js';
import * as manage from './auctions.manage.service.js';

const P = PERMISSIONS;
const ctx = (req) => ({ actorId: req.auth.userId, req });
const idParam = z.object({ id: z.coerce.bigint().positive() });

// ───────────── /api/v1/admin/auctions and /api/v1/admin/bids ─────────────
export const adminAuctionsRouter = Router();
adminAuctionsRouter.use(authenticate, requirePermission(P.ADMIN_ACCESS));

adminAuctionsRouter.get('/', requirePermission(P.AUCTION_MANAGE), validate({ query: adminListQuery }), async (req, res) => {
  res.json(await manage.listAuctionsAdmin(req.valid.query));
});

adminAuctionsRouter.post('/', requirePermission(P.AUCTION_MANAGE), validate({ body: createAuctionSchema }), async (req, res) => {
  res.status(201).json({ data: await manage.createAuction(req.valid.body, ctx(req)) });
});

adminAuctionsRouter.get('/:id', requirePermission(P.AUCTION_MANAGE), validate({ params: idParam }), async (req, res) => {
  res.json({ data: await manage.getAuctionManaged(req.valid.params.id) });
});

adminAuctionsRouter.post('/:id/cancel', requirePermission(P.AUCTION_CANCEL), validate({ params: idParam, body: reasonSchema }), async (req, res) => {
  res.json({ data: await manage.cancelAuctionAdmin(req.valid.params.id, req.valid.body.reason, ctx(req)) });
});

adminAuctionsRouter.patch('/:id', requirePermission(P.AUCTION_MANAGE), validate({ params: idParam, body: adminPatchSchema }), async (req, res) => {
  res.json({ data: await manage.patchAuctionAdmin(req.valid.params.id, req.valid.body, ctx(req)) });
});

export const adminBidsRouter = Router();
adminBidsRouter.use(authenticate, requirePermission(P.ADMIN_ACCESS, P.BID_MONITOR));

adminBidsRouter.get('/', validate({ query: adminBidsQuery }), async (req, res) => {
  res.json(await manage.listBidsAdmin(req.valid.query));
});
