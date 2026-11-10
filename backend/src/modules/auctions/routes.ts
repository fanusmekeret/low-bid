import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { optionalAuth, requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/async.js";
import { notFound } from "../../utils/errors.js";
import { auctionCard, auctionDetail } from "./views.js";

export const auctionRoutes = Router();

const cardInclude = { product: { include: { images: { orderBy: { sortOrder: "asc" as const }, take: 1 } } } };
const PUBLIC_STATUSES = ["SCHEDULED", "LIVE", "CLOSED", "NO_SALE"] as const;
const idParam = z.object({ id: z.string().regex(/^\d{1,19}$/) });

auctionRoutes.get(
  "/home",
  ah(async (_req, res) => {
    const now = new Date();
    const soon = new Date(now.getTime() + 60 * 60 * 1000);
    const q = (where: Prisma.AuctionWhereInput, orderBy: Prisma.AuctionOrderByWithRelationInput) =>
      prisma.auction.findMany({ where, orderBy, take: 12, include: cardInclude });
    const [featured, live, endingSoon, upcoming, recent, categories] = await Promise.all([
      q({ isFeatured: true, status: { in: ["LIVE", "SCHEDULED"] } }, { endsAt: "asc" }),
      q({ status: "LIVE" }, { bidCount: "desc" }),
      q({ status: "LIVE", endsAt: { lte: soon } }, { endsAt: "asc" }),
      q({ status: "SCHEDULED" }, { startsAt: "asc" }),
      q({ status: { in: ["LIVE", "SCHEDULED"] } }, { createdAt: "desc" }),
      prisma.category.findMany({ where: { parentId: null, isActive: true }, orderBy: { sortOrder: "asc" } }),
    ]);
    res.json({
      data: {
        featured: featured.map(auctionCard),
        live: live.map(auctionCard),
        ending_soon: endingSoon.map(auctionCard),
        upcoming: upcoming.map(auctionCard),
        recent: recent.map(auctionCard),
        categories: categories.map((c) => ({ id: c.id, slug: c.slug, name_en: c.nameEn, name_am: c.nameAm })),
      },
    });
  }),
);

const listQuery = z.object({
  status: z.enum(["LIVE", "SCHEDULED", "CLOSED"]).optional(),
  category: z.string().max(80).optional(),
  q: z.string().trim().max(100).optional(),
  condition: z.enum(["NEW", "LIKE_NEW", "USED_GOOD", "USED_FAIR", "FOR_PARTS"]).optional(),
  min: z.string().regex(/^\d{1,15}$/).optional(), // current price filter, santim
  max: z.string().regex(/^\d{1,15}$/).optional(),
  sort: z.enum(["ending", "newest", "popular"]).default("ending"),
  cursor: z.string().regex(/^\d{1,19}$/).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

auctionRoutes.get(
  "/auctions",
  validate(listQuery, "query"),
  ah(async (req, res) => {
    const f = req.query as unknown as z.infer<typeof listQuery>;
    const where: Prisma.AuctionWhereInput = {
      status: f.status ?? { in: ["LIVE", "SCHEDULED"] },
      product: {
        ...(f.category ? { category: { OR: [{ slug: f.category }, { parent: { slug: f.category } }] } } : {}),
        ...(f.condition ? { condition: f.condition } : {}),
        ...(f.q ? { OR: [{ title: { contains: f.q } }, { description: { contains: f.q } }] } : {}),
      },
      ...(f.min || f.max
        ? { currentPrice: { ...(f.min ? { gte: BigInt(f.min) } : {}), ...(f.max ? { lte: BigInt(f.max) } : {}) } }
        : {}),
    };
    const orderBy: Prisma.AuctionOrderByWithRelationInput[] =
      f.sort === "newest" ? [{ createdAt: "desc" }, { id: "desc" }] : f.sort === "popular" ? [{ bidCount: "desc" }, { id: "desc" }] : [{ endsAt: "asc" }, { id: "asc" }];
    const items = await prisma.auction.findMany({
      where,
      orderBy,
      take: f.limit + 1,
      ...(f.cursor ? { cursor: { id: BigInt(f.cursor) }, skip: 1 } : {}),
      include: cardInclude,
    });
    const page = items.slice(0, f.limit);
    res.json({ data: page.map(auctionCard), meta: { next_cursor: items.length > f.limit ? page[page.length - 1].id.toString() : null } });
  }),
);

auctionRoutes.get(
  "/auctions/:id",
  optionalAuth,
  validate(idParam, "params"),
  ah(async (req, res) => {
    const a = await prisma.auction.findFirst({
      where: { id: BigInt(req.params.id), status: { in: [...PUBLIC_STATUSES] } },
      include: {
        product: {
          include: { images: true, specs: true, category: true, seller: { select: { id: true, fullName: true } } },
        },
      },
    });
    if (!a) throw notFound("Auction");
    const watching = req.user
      ? (await prisma.auctionWatchlist.findUnique({ where: { userId_auctionId: { userId: req.user.id, auctionId: a.id } } })) !== null
      : false;
    res.json({ data: { ...auctionDetail(a, req.user?.id), watching } });
  }),
);

auctionRoutes.post(
  "/auctions/:id/watch",
  requireAuth,
  validate(idParam, "params"),
  ah(async (req, res) => {
    const auctionId = BigInt(req.params.id);
    if (!(await prisma.auction.findUnique({ where: { id: auctionId }, select: { id: true } }))) throw notFound("Auction");
    await prisma.auctionWatchlist.upsert({
      where: { userId_auctionId: { userId: req.user!.id, auctionId } },
      create: { userId: req.user!.id, auctionId },
      update: {},
    });
    res.json({ data: { watching: true } });
  }),
);

auctionRoutes.delete(
  "/auctions/:id/watch",
  requireAuth,
  validate(idParam, "params"),
  ah(async (req, res) => {
    await prisma.auctionWatchlist.deleteMany({ where: { userId: req.user!.id, auctionId: BigInt(req.params.id) } });
    res.json({ data: { watching: false } });
  }),
);

auctionRoutes.get(
  "/me/watchlist",
  requireAuth,
  ah(async (req, res) => {
    const rows = await prisma.auctionWatchlist.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "desc" },
      include: { auction: { include: cardInclude } },
    });
    res.json({ data: rows.map((r) => auctionCard(r.auction)) });
  }),
);

auctionRoutes.get(
  "/me/bids",
  requireAuth,
  ah(async (req, res) => {
    // One row per auction the user bid on, with their best bid and whether they lead.
    const auctions = await prisma.auction.findMany({
      where: { bids: { some: { bidderId: req.user!.id } } },
      orderBy: { endsAt: "desc" },
      take: 100,
      include: { ...cardInclude, bids: { where: { bidderId: req.user!.id }, orderBy: { amount: "desc" }, take: 1 } },
    });
    res.json({
      data: auctions.map((a) => ({
        auction: auctionCard(a),
        my_best_bid_minor: a.bids[0]?.amount.toString() ?? null,
        is_leading: a.currentWinnerId === req.user!.id,
      })),
    });
  }),
);
