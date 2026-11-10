import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { authenticate, requirePermission, requireVerifiedPhone } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { etbToMinor } from '../../utils/money.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { myBidsOnAuction, placeBid } from './bids.service.js';

// 10 bids per 10 seconds per user: each bid opens a fee checkout, so this is plenty.
const bidLimiter = rateLimit({
  windowMs: 10_000,
  limit: env.isTest ? 10_000 : 10,
  keyGenerator: (req) => `bid:${req.auth.userId}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'You are bidding too fast. Wait a moment' } }),
});

const bidSchema = z.object({
  // ETB as a string ("37" or "37.45"); converted to santim without floating point. Secret until the close.
  amount: z.string().trim().regex(/^\d{1,13}(\.\d{1,2})?$/, 'Enter the amount in birr, e.g. 37.45'),
  // A new random value (UUID) per bid; resending the same key never places a second bid.
  idempotencyKey: z.string().trim().regex(/^[A-Za-z0-9_-]{8,64}$/, 'idempotencyKey must be 8–64 letters, digits, - or _'),
});

export const bidsRouter = Router({ mergeParams: true });

// POST /api/v1/auctions/:id/bids → { bid, payment }: open payment.checkoutUrl to pay the bid fee.
bidsRouter.post(
  '/',
  authenticate,
  requirePermission(PERMISSIONS.BID_PLACE),
  requireVerifiedPhone,
  bidLimiter,
  validate({ params: z.object({ id: z.coerce.bigint().positive() }), body: bidSchema }),
  async (req, res) => {
    const result = await placeBid({
      auctionId: req.valid.params.id,
      userId: req.auth.userId,
      amount: etbToMinor(req.valid.body.amount),
      idempotencyKey: req.valid.body.idempotencyKey,
      ip: req.ip,
    });
    res.status(result.replay ? 200 : 201).json({ data: result });
  },
);

// GET /api/v1/auctions/:id/bids/mine: my own bids on this auction (amounts and whether each fee is paid).
bidsRouter.get('/mine', authenticate, validate({ params: z.object({ id: z.coerce.bigint().positive() }) }), async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: await myBidsOnAuction(req.valid.params.id, req.auth.userId) });
});
