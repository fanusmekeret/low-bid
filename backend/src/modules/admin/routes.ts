import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { scheduleStart } from "../../jobs/queues.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { realtime } from "../../sockets/realtime.js";
import { ah } from "../../utils/async.js";
import { conflict, notFound } from "../../utils/errors.js";
import { record } from "../audit/service.js";

export const adminRoutes = Router();
adminRoutes.use("/admin", requireAuth);

const idParam = z.object({ id: z.string().regex(/^\d{1,19}$/) });

adminRoutes.get(
  "/admin/sellers",
  requirePermission("seller:review"),
  ah(async (req, res) => {
    const status = (req.query.status as string | undefined) ?? "PENDING";
    const rows = await prisma.sellerProfile.findMany({
      where: { status: status as "PENDING" | "APPROVED" | "REJECTED" },
      include: { user: { select: { fullName: true, phone: true } } },
      orderBy: { createdAt: "asc" },
    });
    res.json({ data: rows });
  }),
);

adminRoutes.post(
  "/admin/sellers/:id/approve",
  requirePermission("seller:review"),
  validate(idParam, "params"),
  ah(async (req, res) => {
    const id = BigInt(req.params.id);
    await prisma.$transaction(async (tx) => {
      const before = await tx.sellerProfile.findUnique({ where: { id } });
      if (!before) throw notFound("Seller");
      const after = await tx.sellerProfile.update({ where: { id }, data: { status: "APPROVED", approvedAt: new Date() } });
      const role = await tx.role.findUniqueOrThrow({ where: { code: "seller" } });
      await tx.userRole.upsert({
        where: { userId_roleId: { userId: before.userId, roleId: role.id } },
        create: { userId: before.userId, roleId: role.id },
        update: {},
      });
      await record(tx, { actorId: req.user!.id, action: "seller.approve", entity: "seller_profile", entityId: id, before, after, ip: req.ip });
    });
    res.json({ data: { ok: true } });
  }),
);

adminRoutes.get(
  "/admin/auctions",
  requirePermission("auction:review"),
  ah(async (req, res) => {
    const status = (req.query.status as string | undefined) ?? "PENDING_APPROVAL";
    const rows = await prisma.auction.findMany({
      where: { status: status as "PENDING_APPROVAL" },
      include: { product: { include: { specs: true, images: true } } },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    res.json({ data: rows });
  }),
);

adminRoutes.post(
  "/admin/auctions/:id/approve",
  requirePermission("auction:review"),
  validate(idParam, "params"),
  ah(async (req, res) => {
    const id = BigInt(req.params.id);
    const auction = await prisma.$transaction(async (tx) => {
      const before = await tx.auction.findUnique({ where: { id } });
      if (!before) throw notFound("Auction");
      if (before.status !== "PENDING_APPROVAL") throw conflict("INVALID_STATE", `Auction is ${before.status}`);
      await tx.product.update({ where: { id: before.productId }, data: { status: "APPROVED" } });
      const after = await tx.auction.update({ where: { id }, data: { status: "SCHEDULED" } });
      await record(tx, { actorId: req.user!.id, action: "auction.approve", entity: "auction", entityId: id, before, after, ip: req.ip });
      return after;
    });
    await scheduleStart(auction.id, auction.startsAt);
    res.json({ data: { id: auction.id.toString(), status: auction.status } });
  }),
);

adminRoutes.post(
  "/admin/auctions/:id/cancel",
  requirePermission("auction:cancel"),
  validate(idParam, "params"),
  validate(z.object({ reason: z.string().trim().min(3).max(255) })),
  ah(async (req, res) => {
    const id = BigInt(req.params.id);
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM auctions WHERE id = ${id} FOR UPDATE`;
      if (!rows[0]) throw notFound("Auction");
      if (!["PENDING_APPROVAL", "SCHEDULED", "LIVE"].includes(rows[0].status)) throw conflict("INVALID_STATE", `Auction is ${rows[0].status}`);
      await tx.auction.update({ where: { id }, data: { status: "CANCELLED" } });
      await record(tx, { actorId: req.user!.id, action: "auction.cancel", entity: "auction", entityId: id, before: rows[0], after: { status: "CANCELLED", reason: req.body.reason }, ip: req.ip });
    });
    realtime().to(`auction:${id}`).emit("auction:closed", { auctionId: id.toString(), status: "CANCELLED", finalAmount_minor: null, winnerAlias: null });
    res.json({ data: { ok: true } });
  }),
);
