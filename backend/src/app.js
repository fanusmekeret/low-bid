import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { corsOrigin } from './utils/cors.js';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { requestId } from './middleware/requestId.js';
import { adminUsersRouter } from './modules/admin/users.admin.routes.js';
import { adminAuctionsRouter, adminBidsRouter } from './modules/auctions/auctions.manage.routes.js';
import { auctionsRouter, homeRouter, myAuctionsRouter } from './modules/auctions/catalog.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { adminCategoriesRouter, categoriesRouter } from './modules/categories/categories.routes.js';
import { privateFilesRouter, publicMediaRouter } from './modules/media/media.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { adminPaymentsRouter, myPaymentsRouter, paymentsRouter } from './modules/payments/payments.routes.js';
import { adminProductsRouter } from './modules/products/products.routes.js';
import { adminSettingsRouter } from './modules/settings/settings.admin.routes.js';
import { meRouter } from './modules/users/users.routes.js';
import { logger } from './utils/logger.js';

// Prisma returns BigInt for BIGINT columns; serialize them as exact strings.
// eslint-disable-next-line no-extend-native
BigInt.prototype.toJSON = function toJSON() { return this.toString(); };

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Caddy (and Cloudflare in front of it) sets X-Forwarded-For

  app.use(requestId);
  // Every response carries the server clock (epoch ms) so the app can run countdowns on server time.
  app.use((_req, res, next) => { res.set('X-Server-Time', String(Date.now())); next(); });
  app.use(pinoHttp({ logger, genReqId: (req) => req.id, autoLogging: { ignore: (req) => req.url === '/healthz' } }));
  app.use(helmet());
  app.use(cors({
    // Mobile apps send no Origin header; browsers must be on the allow list
    // (plus any localhost port in development, for Flutter web).
    origin: corsOrigin,
    credentials: false,
    exposedHeaders: ['X-Server-Time', 'X-Request-Id'], // readable by the Flutter Web admin
    maxAge: 600,
  }));
  app.use(compression());
  app.use(express.json({
    limit: '100kb',
    // Keep the exact bytes of Chapa webhooks for signature checking.
    verify: (req, _res, buf) => { if (req.originalUrl.startsWith('/api/v1/payments/chapa/')) req.rawBody = Buffer.from(buf); },
  }));

  app.get('/healthz', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Product photos (local storage driver). Immutable, cached for a year.
  app.use('/media', publicMediaRouter());

  const api = express.Router();
  api.use(globalLimiter);
  api.use('/auth', authRouter);
  api.use('/me', myAuctionsRouter); // /me/bids, /me/auctions/won|lost, /me/watchlist
  api.use('/me', myPaymentsRouter); // /me/auctions/:id/confirm-received
  api.use('/payments', paymentsRouter); // checkout, status, receipts, Chapa webhook/callback/return
  api.use('/me', meRouter);
  api.use('/notifications', notificationsRouter);
  api.use('/categories', categoriesRouter);
  api.use('/home', homeRouter);
  api.use('/auctions', auctionsRouter); // includes POST /auctions/:id/bids
  api.use('/files/private', privateFilesRouter());
  // LOW BID is the only seller: listings and auctions are managed by staff under /admin.
  // Admin routes: specific sections first, then the users/roles router at /admin.
  api.use('/admin/products', adminProductsRouter);
  api.use('/admin/auctions', adminAuctionsRouter);
  api.use('/admin/bids', adminBidsRouter);
  api.use('/admin', adminPaymentsRouter); // /admin/payments, /refunds, /orders, /ledger
  api.use('/admin/categories', adminCategoriesRouter);
  api.use('/admin/settings', adminSettingsRouter);
  api.use('/admin', adminUsersRouter);
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
