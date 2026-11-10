import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { ah } from "../../utils/async.js";

export const categoryRoutes = Router();

categoryRoutes.get(
  "/categories",
  ah(async (_req, res) => {
    const all = await prisma.category.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
    const view = (c: (typeof all)[number]) => ({ id: c.id, slug: c.slug, name_en: c.nameEn, name_am: c.nameAm, requires_deposit: c.requiresDeposit });
    res.json({
      data: all.filter((c) => c.parentId === null).map((p) => ({ ...view(p), children: all.filter((c) => c.parentId === p.id).map(view) })),
    });
  }),
);
