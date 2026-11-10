import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { optionalAuth, requireAuth } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rateLimit.js";
import { requirePermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/async.js";
import { AppError } from "../../utils/errors.js";
import { bidderAlias } from "../../utils/mask.js";
import { money } from "../../utils/money.js";
import { placeBid } from "./service.js";

export const bidRoutes = Router();

const idParam = z.object({ id: z.string().regex(/^\d{1,19}$/) });
const bidBody = z.object({
  amount_minor: z.union([z.string().regex(/^\d{1,15}$/), z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]).transform((v) => BigInt(v)),
  idempotency_key: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
});

bidRoutes.post(
  "/auctions/:id/bids",
  requireAuth,
  requirePermission("bid:place"),
  (req, _res, next) => next(req.user!.phoneVerified ? undefined : new AppError(403, "PHONE_NOT_VERIFIED", "Verify your phone to bid")),
  rateLimit("bid", 10, 10, (req) => req.user!.id.toString()),
  validate(idParam, "params"),
  validate(bidBody),
  ah(async (req, res) => {
    const result = await placeBid({
      auctionId: BigInt(req.params.id),
      bidderId: req.user!.id,
      amount: req.body.amount_minor,
      idempotencyKey: req.body.idempotency_key,
      ip: req.ip,
    });
    res.status(result.replayed ? 200 : 201).json({ data: result.bid });
  }),
);

bidRoutes.get(
  "/auctions/:id/bids",
  optionalAuth,
  validate(idParam, "params"),
  ah(async (req, res) => {
    const bids = await prisma.bid.findMany({
      where: { auctionId: BigInt(req.params.id) },
      orderBy: { amount: "desc" },
      take: 100,
      include: { bidder: { select: { fullName: true } } },
    });
    res.json({
      data: bids.map((b) => ({
        id: b.id.toString(),
        bidder_alias: bidderAlias(b.bidder.fullName, b.bidderId),
        is_me: req.user?.id === b.bidderId,
        ...money(b.amount),
        created_at: b.createdAt.toISOString(),
      })),
    });
  }),
);
