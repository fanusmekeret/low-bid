import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { imageUrls } from '../../services/media/productImages.js';
import { getStorage } from '../../services/storage/index.js';
import { conflict, notFound } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { moneyDto } from '../../utils/money.js';
import { presentCategory } from '../categories/categories.tree.js';
import { presentAuctionCard, presentAuctionDetail } from './auction.presenter.js';
import { aliasSecret } from '../bids/bids.service.js';
import { PUBLIC_STATUSES, bidderAlias, myAuctionStatus } from './auction.rules.js';
import { buildSearch } from './search.js';

const media = { imageUrls };
const CARD_INCLUDE = { product: { include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 }, category: true } } };
const DETAIL_INCLUDE = { product: { include: { images: { orderBy: { sortOrder: 'asc' } }, category: true, seller: true } }, result: true };
const card = (a) => presentAuctionCard(a, media);

// ───────────────────────────── View counts ─────────────────────────────
// Counted in memory and written every 30 s, so busy auctions are not slowed by a row
// update on every page view (bids lock the same row).
const pendingViews = new Map();
let flushTimer;
function countView(auctionId) {
  const key = String(auctionId);
  pendingViews.set(key, (pendingViews.get(key) ?? 0) + 1);
  flushTimer ??= setInterval(flushViews, 30_000).unref();
}
export async function flushViews() {
  const batch = [...pendingViews.entries()];
  pendingViews.clear();
  for (const [id, n] of batch) {
    await prisma.auction.update({ where: { id: BigInt(id) }, data: { viewCount: { increment: n } } }).catch((err) => logger.warn({ err }, 'view count flush failed'));
  }
}

// ───────────────────────────── Home ─────────────────────────────

const HOME_TTL_MS = 15_000;
let homeCache = null;

export async function home() {
  if (homeCache && Date.now() - homeCache.at < HOME_TTL_MS) return homeCache.data;
  const now = new Date();
  const open = { status: { in: ['LIVE', 'SCHEDULED'] } };
  const [banners, featured, endingSoon, live, upcoming, recent, popular] = await Promise.all([
    prisma.banner.findMany({
      where: { isActive: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }] },
      orderBy: { sortOrder: 'asc' },
      take: 6,
    }),
    prisma.auction.findMany({ where: { ...open, isFeatured: true }, include: CARD_INCLUDE, orderBy: { endsAt: 'asc' }, take: 10 }),
    prisma.auction.findMany({ where: { status: 'LIVE', endsAt: { lte: new Date(now.getTime() + 3_600_000) } }, include: CARD_INCLUDE, orderBy: { endsAt: 'asc' }, take: 10 }),
    prisma.auction.findMany({ where: { status: 'LIVE' }, include: CARD_INCLUDE, orderBy: [{ bidCount: 'desc' }, { endsAt: 'asc' }], take: 10 }),
    prisma.auction.findMany({ where: { status: 'SCHEDULED' }, include: CARD_INCLUDE, orderBy: { startsAt: 'asc' }, take: 10 }),
    prisma.auction.findMany({ where: open, include: CARD_INCLUDE, orderBy: { approvedAt: 'desc' }, take: 10 }),
    prisma.$queryRaw`
      SELECT p.category_id AS categoryId, COUNT(*) AS openAuctions
      FROM auctions a JOIN products p ON p.id = a.product_id
      WHERE a.status IN ('LIVE', 'SCHEDULED')
      GROUP BY p.category_id ORDER BY openAuctions DESC LIMIT 8`,
  ]);
  const categories = await prisma.category.findMany({ where: { id: { in: popular.map((r) => Number(r.categoryId)) }, isActive: true } });
  const byId = new Map(categories.map((c) => [c.id, c]));
  const storage = getStorage();

  const data = {
    banners: banners.map((b) => ({ id: b.id, titleEn: b.titleEn, titleAm: b.titleAm, imageUrl: storage.publicUrl(b.imageKey), linkType: b.linkType, linkValue: b.linkValue })),
    featured: featured.map(card),
    endingSoon: endingSoon.map(card),
    live: live.map(card),
    upcoming: upcoming.map(card),
    recentlyAdded: recent.map(card),
    popularCategories: popular
      .filter((r) => byId.has(Number(r.categoryId)))
      .map((r) => ({ ...presentCategory(byId.get(Number(r.categoryId))), openAuctions: Number(r.openAuctions) })),
  };
  homeCache = { at: Date.now(), data };
  return data;
}

export const invalidateHomeCache = () => { homeCache = null; };

// ───────────────────────────── Search and browse ─────────────────────────────

async function categoryIds(slug) {
  const c = await prisma.category.findUnique({ where: { slug }, include: { children: { select: { id: true } } } });
  if (!c) return [];
  return [c.id, ...c.children.map((ch) => ch.id)];
}

async function matchingProductIds(q) {
  const { boolean, fallback } = buildSearch(q);
  if (boolean) {
    const rows = await prisma.$queryRaw`
      SELECT id FROM products
      WHERE status = 'APPROVED' AND MATCH(title, description) AGAINST (${boolean} IN BOOLEAN MODE)
      LIMIT 1000`;
    return rows.map((r) => r.id);
  }
  if (!fallback) return [];
  const rows = await prisma.product.findMany({ where: { status: 'APPROVED', title: { contains: fallback } }, select: { id: true }, take: 1000 });
  return rows.map((r) => r.id);
}

const SORTS = {
  ending_soon: [{ endsAt: 'asc' }],
  newest: [{ approvedAt: 'desc' }, { id: 'desc' }],
  most_bids: [{ bidCount: 'desc' }, { endsAt: 'asc' }],
  starting_soon: [{ startsAt: 'asc' }],
};

export async function searchAuctions({ status, category, q, condition, featured, sort, page, pageSize }) {
  const statusWhere = {
    live: { status: 'LIVE' },
    upcoming: { status: 'SCHEDULED' },
    open: { status: { in: ['LIVE', 'SCHEDULED'] } },
    ended: { status: 'CLOSED', closedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
  }[status];

  const productWhere = { ...(condition && { condition }) };
  if (category) productWhere.categoryId = { in: await categoryIds(category) };
  if (q) productWhere.id = { in: await matchingProductIds(q) };

  const where = { ...statusWhere, ...(featured && { isFeatured: true }), product: productWhere };
  const orderBy = status === 'ended' ? [{ closedAt: 'desc' }] : SORTS[sort];
  const [total, rows] = await Promise.all([
    prisma.auction.count({ where }),
    prisma.auction.findMany({ where, include: CARD_INCLUDE, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return { data: rows.map(card), meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}

// ───────────────────────────── Auction page ─────────────────────────────

export async function auctionDetail(auctionId, viewerId) {
  const a = await prisma.auction.findUnique({ where: { id: BigInt(auctionId) }, include: DETAIL_INCLUDE });
  if (!a || !PUBLIC_STATUSES.includes(a.status)) throw notFound('AUCTION_NOT_FOUND', 'Auction not found');
  countView(a.id);

  const detail = presentAuctionDetail(a, { imageUrls });
  detail.result = null;
  if (a.status === 'CLOSED' && a.result) {
    // Bidding is over: the winning amount and how many amounts were unique can be shown.
    const [groups, winner] = await Promise.all([
      prisma.bid.groupBy({ by: ['amount'], where: { auctionId: a.id, status: 'ACTIVE' }, _count: { _all: true } }),
      a.result.winnerId ? prisma.user.findUnique({ where: { id: a.result.winnerId }, select: { firstName: true } }) : null,
    ]);
    detail.result = {
      outcome: a.result.outcome,
      finalPrice: moneyDto(a.result.finalPrice),
      winnerAlias: winner ? bidderAlias(winner.firstName, a.id, a.result.winnerId, aliasSecret()) : null,
      paidBids: groups.reduce((n, g) => n + g._count._all, 0),
      uniqueBids: groups.filter((g) => g._count._all === 1).length,
    };
  }

  if (viewerId) {
    const me = BigInt(viewerId);
    const [watch, mine] = await Promise.all([
      prisma.auctionWatchlist.findUnique({ where: { userId_auctionId: { userId: me, auctionId: a.id } } }),
      prisma.bid.groupBy({ by: ['status'], where: { auctionId: a.id, bidderId: me, status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } }, _count: { _all: true } }),
    ]);
    const count = (st) => mine.find((g) => g.status === st)?._count._all ?? 0;
    detail.viewer = {
      isWatching: Boolean(watch),
      myBidCount: count('ACTIVE'),
      myPendingCount: count('PENDING_PAYMENT'),
      myStatus: count('ACTIVE') > 0 ? myAuctionStatus(a, me) : null,
    };
  }
  return detail;
}

// ───────────────────────────── Watchlist ─────────────────────────────

export async function watch(userId, auctionId) {
  const a = await prisma.auction.findUnique({ where: { id: BigInt(auctionId) }, select: { status: true } });
  if (!a || !PUBLIC_STATUSES.includes(a.status)) throw notFound('AUCTION_NOT_FOUND', 'Auction not found');
  if (a.status === 'CLOSED') throw conflict('AUCTION_ENDED', 'This auction has ended');
  await prisma.auctionWatchlist.upsert({
    where: { userId_auctionId: { userId: BigInt(userId), auctionId: BigInt(auctionId) } },
    update: {},
    create: { userId: BigInt(userId), auctionId: BigInt(auctionId) },
  });
}

export async function unwatch(userId, auctionId) {
  await prisma.auctionWatchlist.deleteMany({ where: { userId: BigInt(userId), auctionId: BigInt(auctionId) } });
}

export async function myWatchlist(userId, { status, page, pageSize }) {
  const where = {
    userId: BigInt(userId),
    auction: status === 'active' ? { status: { in: ['LIVE', 'SCHEDULED'] } } : { status: { in: ['CLOSED', 'CANCELLED'] } },
  };
  const [total, rows] = await Promise.all([
    prisma.auctionWatchlist.count({ where }),
    prisma.auctionWatchlist.findMany({ where, include: { auction: { include: CARD_INCLUDE } }, orderBy: { auction: { endsAt: 'asc' } }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return { data: rows.map((w) => card(w.auction)), meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}

// ───────────────────────────── My bids / won / lost ─────────────────────────────

/**
 * Auctions I have bid on (paid or awaiting the fee), as cards with no prices.
 * status: active (live or scheduled), ended (closed or cancelled), lost (closed, not won by me).
 */
export async function myBids(userId, { status, page, pageSize }) {
  const me = BigInt(userId);
  const statuses = status === 'active' ? ['LIVE', 'SCHEDULED'] : status === 'lost' ? ['CLOSED'] : ['CLOSED', 'CANCELLED'];
  const notWon = status === 'lost'
    ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM auction_results r WHERE r.auction_id = a.id AND r.winner_id = ${me} AND r.outcome = 'SOLD')`
    : Prisma.empty;
  const rows = await prisma.$queryRaw`
    SELECT b.auction_id AS auctionId, MAX(b.created_at) AS lastBidAt
    FROM bids b JOIN auctions a ON a.id = b.auction_id
    WHERE b.bidder_id = ${me} AND b.status <> 'VOID' AND a.status IN (${Prisma.join(statuses)}) ${notWon}
    GROUP BY b.auction_id
    ORDER BY lastBidAt DESC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
  const [{ total }] = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT b.auction_id) AS total
    FROM bids b JOIN auctions a ON a.id = b.auction_id
    WHERE b.bidder_id = ${me} AND b.status <> 'VOID' AND a.status IN (${Prisma.join(statuses)}) ${notWon}`;

  const auctions = await prisma.auction.findMany({ where: { id: { in: rows.map((r) => r.auctionId) } }, include: { ...CARD_INCLUDE, result: true } });
  const byId = new Map(auctions.map((a) => [a.id, a]));
  const data = rows
    .map((r) => byId.get(r.auctionId))
    .filter(Boolean)
    .map((a) => ({ ...card(a), myStatus: myAuctionStatus(a, me) }));
  return { data, meta: { page, pageSize, total: Number(total), totalPages: Math.ceil(Number(total) / pageSize) } };
}

/** Auctions I won, with what I owe and by when (these are payments, so amounts are shown). */
export async function myWon(userId, { page, pageSize }) {
  const where = { winnerId: BigInt(userId), outcome: 'SOLD' };
  const [total, rows] = await Promise.all([
    prisma.auctionResult.count({ where }),
    prisma.auctionResult.findMany({
      where,
      include: {
        auction: { include: CARD_INCLUDE },
        // The paid checkout (if any), so the app can open its receipt or ask for a refund.
        payments: { where: { userId: BigInt(userId), status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }, select: { txRef: true }, orderBy: { verifiedAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    data: rows.map((r) => ({
      ...card(r.auction),
      result: {
        status: r.status,
        finalPrice: moneyDto(r.finalPrice),
        buyerPremium: moneyDto(r.buyerPremium),
        totalDue: moneyDto(r.totalDue),
        paymentDeadline: r.paymentDeadline,
        paidAt: r.paidAt,
        txRef: r.payments[0]?.txRef ?? null,
      },
    })),
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

export const myLost = (userId, query) => myBids(userId, { ...query, status: 'lost' });
