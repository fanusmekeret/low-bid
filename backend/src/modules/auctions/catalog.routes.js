import { Router } from 'express';
import { z } from 'zod';
import { authenticate, optionalAuth, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { bidHistory } from '../bids/bids.service.js';
import { bidsRouter } from '../bids/bids.routes.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { catalogQuery, historyQuery, myListQuery } from './auctions.schemas.js';
import * as catalog from './catalog.service.js';

const idParam = z.object({ id: z.coerce.bigint().positive() });

// ───────────── Public: /api/v1/home and /api/v1/auctions ─────────────
export const homeRouter = Router();
homeRouter.get('/', async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=10');
  res.json({ data: await catalog.home() });
});

export const auctionsRouter = Router();

auctionsRouter.get('/', validate({ query: catalogQuery }), async (req, res) => {
  res.json(await catalog.searchAuctions(req.valid.query));
});

auctionsRouter.get('/:id', optionalAuth, validate({ params: idParam }), async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: await catalog.auctionDetail(req.valid.params.id, req.auth?.userId) });
});

auctionsRouter.get('/:id/bids', optionalAuth, validate({ params: idParam, query: historyQuery }), async (req, res) => {
  res.json(await bidHistory(req.valid.params.id, { ...req.valid.query, viewerId: req.auth?.userId }));
});

auctionsRouter.use('/:id/bids', bidsRouter);

auctionsRouter.post('/:id/watch', authenticate, requirePermission(PERMISSIONS.WATCHLIST_MANAGE), validate({ params: idParam }), async (req, res) => {
  await catalog.watch(req.auth.userId, req.valid.params.id);
  res.status(204).end();
});

auctionsRouter.delete('/:id/watch', authenticate, requirePermission(PERMISSIONS.WATCHLIST_MANAGE), validate({ params: idParam }), async (req, res) => {
  await catalog.unwatch(req.auth.userId, req.valid.params.id);
  res.status(204).end();
});

// ───────────── Signed in: /api/v1/me/... ─────────────
export const myAuctionsRouter = Router();
myAuctionsRouter.use(authenticate);

myAuctionsRouter.get('/bids', validate({ query: myListQuery }), async (req, res) => {
  res.json(await catalog.myBids(req.auth.userId, req.valid.query));
});
myAuctionsRouter.get('/auctions/won', validate({ query: myListQuery }), async (req, res) => {
  res.json(await catalog.myWon(req.auth.userId, req.valid.query));
});
myAuctionsRouter.get('/auctions/lost', validate({ query: myListQuery }), async (req, res) => {
  res.json(await catalog.myLost(req.auth.userId, req.valid.query));
});
myAuctionsRouter.get('/watchlist', validate({ query: myListQuery }), async (req, res) => {
  res.json(await catalog.myWatchlist(req.auth.userId, req.valid.query));
});
