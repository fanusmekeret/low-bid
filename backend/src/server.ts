import { createServer } from "node:http";
import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { attachRealtime } from "./sockets/realtime.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";

const cfg = env();
const http = createServer(createApp());
attachRealtime(http, cfg.CORS_ORIGINS.split(",").filter(Boolean));

http.listen(cfg.PORT, () => logger.info({ port: cfg.PORT }, "LOW BID API listening"));

const shutdown = async () => {
  http.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
