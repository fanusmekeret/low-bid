import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { ah } from "../../utils/async.js";

export const notificationRoutes = Router();

notificationRoutes.get(
  "/notifications",
  requireAuth,
  ah(async (req, res) => {
    const items = await prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json({ data: items });
  }),
);

notificationRoutes.post(
  "/notifications/:id/read",
  requireAuth,
  ah(async (req, res) => {
    await prisma.notification.updateMany({
      where: { id: BigInt(req.params.id), userId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ data: { ok: true } });
  }),
);

notificationRoutes.post(
  "/notifications/read-all",
  requireAuth,
  ah(async (req, res) => {
    await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
    res.json({ data: { ok: true } });
  }),
);
