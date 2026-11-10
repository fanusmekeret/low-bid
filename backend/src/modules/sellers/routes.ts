import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { ah } from "../../utils/async.js";
import { badRequest, conflict, notFound } from "../../utils/errors.js";

export const sellerRoutes = Router();

// Decision (7 Nov 2026): spec sheets and headlines must not carry prices.
const PRICE_WORDS = /\b(etb|birr)\b|ብር/i;
const noPrice = (s: string) => !PRICE_WORDS.test(s);
const text = (max: number) => z.string().trim().min(1).max(max).refine(noPrice, "Prices belong in the auction, not the specs");

const SPEC_GROUPS = ["General", "Display", "Performance", "Cameras", "Battery", "Connectivity", "Condition and box"] as const;

const productBody = z.object({
  category_id: z.number().int().positive(),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(5000),
  condition: z.enum(["NEW", "LIKE_NEW", "USED_GOOD", "USED_FAIR", "FOR_PARTS"]),
  location: z.string().trim().min(2).max(80),
  headline: z.array(text(60)).min(1).max(3),
  specs: z
    .array(z.object({ group: z.enum(SPEC_GROUPS), label: text(80), value: text(255) }))
    .max(80)
    .default([]),
});

sellerRoutes.post(
  "/seller/apply",
  requireAuth,
  validate(z.object({ display_name: z.string().trim().min(2).max(120), tin: z.string().max(20).optional(), city: z.string().max(80).optional() })),
  ah(async (req, res) => {
    const existing = await prisma.sellerProfile.findUnique({ where: { userId: req.user!.id } });
    if (existing) throw conflict("ALREADY_APPLIED", "You already have a seller profile");
    const profile = await prisma.sellerProfile.create({
      data: { userId: req.user!.id, displayName: req.body.display_name, tin: req.body.tin, city: req.body.city },
    });
    res.status(201).json({ data: { id: profile.id.toString(), status: profile.status } });
  }),
);

sellerRoutes.post(
  "/seller/products",
  requireAuth,
  requirePermission("product:create"),
  validate(productBody),
  ah(async (req, res) => {
    const b = req.body as z.infer<typeof productBody>;
    if (!(await prisma.category.findUnique({ where: { id: b.category_id } }))) throw badRequest("CATEGORY_INVALID", "Unknown category");
    const product = await prisma.product.create({
      data: {
        sellerId: req.user!.id,
        categoryId: b.category_id,
        title: b.title,
        description: b.description,
        condition: b.condition,
        location: b.location,
        headline: b.headline,
        specs: { create: b.specs.map((s, i) => ({ groupName: s.group, label: s.label, value: s.value, sortOrder: i })) },
      },
    });
    res.status(201).json({ data: { id: product.id.toString(), status: product.status } });
  }),
);

const minor = z.string().regex(/^\d{1,15}$/).transform((v) => BigInt(v));
const auctionBody = z
  .object({
    product_id: z.string().regex(/^\d{1,19}$/),
    start_price_minor: minor,
    min_increment_minor: minor,
    reserve_price_minor: minor.optional(),
    starts_at: z.coerce.date(),
    duration_hours: z.number().int().min(1).max(14 * 24),
  })
  .refine((v) => v.start_price_minor > 0n && v.min_increment_minor > 0n, "Prices must be positive")
  .refine((v) => v.reserve_price_minor === undefined || v.reserve_price_minor >= v.start_price_minor, "Reserve must be at least the start price")
  .refine((v) => v.starts_at.getTime() > Date.now() - 60_000, "Start time must be in the future");

sellerRoutes.post(
  "/seller/auctions",
  requireAuth,
  requirePermission("auction:create"),
  validate(auctionBody),
  ah(async (req, res) => {
    const b = req.body as z.infer<typeof auctionBody>;
    const product = await prisma.product.findFirst({
      where: { id: BigInt(b.product_id), sellerId: req.user!.id },
      include: { category: true, auctions: { where: { status: { in: ["PENDING_APPROVAL", "SCHEDULED", "LIVE"] } } } },
    });
    if (!product) throw notFound("Product");
    if (product.auctions.length > 0) throw conflict("AUCTION_EXISTS", "This product already has an open auction");
    const auction = await prisma.auction.create({
      data: {
        productId: product.id,
        status: "PENDING_APPROVAL",
        startPrice: b.start_price_minor,
        minIncrement: b.min_increment_minor,
        reservePrice: b.reserve_price_minor,
        depositMinor: product.category.requiresDeposit ? product.category.defaultDepositMinor : 0n,
        startsAt: b.starts_at,
        endsAt: new Date(b.starts_at.getTime() + b.duration_hours * 3600_000),
      },
    });
    res.status(201).json({ data: { id: auction.id.toString(), status: auction.status } });
  }),
);

sellerRoutes.get(
  "/seller/auctions",
  requireAuth,
  requirePermission("auction:create"),
  ah(async (req, res) => {
    const rows = await prisma.auction.findMany({
      where: { product: { sellerId: req.user!.id } },
      orderBy: { createdAt: "desc" },
      include: { product: { select: { title: true } }, result: true },
    });
    res.json({
      data: rows.map((a) => ({
        id: a.id.toString(),
        title: a.product.title,
        status: a.status,
        bid_count: a.bidCount,
        current_price_minor: a.currentPrice?.toString() ?? null,
        starts_at: a.startsAt.toISOString(),
        ends_at: a.endsAt.toISOString(),
        result: a.result ? { status: a.result.status, final_price_minor: a.result.finalPrice?.toString() ?? null } : null,
      })),
    });
  }),
);
