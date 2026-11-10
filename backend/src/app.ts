import express from "express";
import helmet from "helmet";
import cors from "cors";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error.js";
import { bigintReplacer } from "./utils/json.js";
import { authRoutes } from "./modules/auth/routes.js";
import { categoryRoutes } from "./modules/categories/routes.js";
import { auctionRoutes } from "./modules/auctions/routes.js";
import { bidRoutes } from "./modules/bids/routes.js";
import { sellerRoutes } from "./modules/sellers/routes.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { notificationRoutes } from "./modules/notifications/routes.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1); // behind Caddy
  app.set("json replacer", bigintReplacer);
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: env().CORS_ORIGINS.split(",").filter(Boolean) }));
  app.use(express.json({ limit: "200kb" }));

  // Clients compute their clock offset from this so countdowns run on server time.
  app.use((_req, res, next) => {
    res.setHeader("X-Server-Time", Date.now().toString());
    next();
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));

  const v1 = express.Router();
  for (const r of [authRoutes, categoryRoutes, auctionRoutes, bidRoutes, sellerRoutes, adminRoutes, notificationRoutes]) v1.use(r);
  app.use("/api/v1", v1);

  app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } }));
  app.use(errorHandler);
  return app;
}
