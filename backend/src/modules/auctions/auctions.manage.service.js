import { prisma } from '../../config/prisma.js';
import { scheduleAuctionJobs } from '../../jobs/queue.js';
import { imageUrls } from '../../services/media/productImages.js';
import { emitToAuction } from '../../sockets/realtime.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { etbToMinor, moneyDto } from '../../utils/money.js';
import { recordAudit } from '../audit/audit.service.js';
import { aliasSecret } from '../bids/bids.service.js';
import { notify } from '../notifications/notifications.service.js';
import { editLock } from '../products/products.rules.js';
import { getSetting } from '../settings/settings.service.js';
import { lockAuction } from './auction.lock.js';
import { bidderAlias, defaultBiddingTerms, rankBids, scheduleOnApproval, validateAuctionDraft, validateBiddingTerms } from './auction.rules.js';
import { cancelAuction } from './lifecycle.service.js';

const INCLUDE = {
  product: { include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 }, category: true, seller: { include: { user: { select: { id: true, firstName: true, lastName: true, phone: true } } } } } },
  result: true,
};

/** Seller and admin view: the seller's price and the bidding terms. Never bid amounts while bidding is open. */
function presentManaged(a, { withSellerContact = false } = {}) {
  const p = a.product;
  const cover = p.images?.[0];
  return {
    id: a.id.toString(),
    status: a.status,
    product: { id: p.id.toString(), title: p.title, status: p.status, coverImage: cover ? imageUrls(cover.key) : null, category: p.category?.slug },
    seller: withSellerContact
      ? { id: p.seller.id.toString(), businessName: p.seller.businessName, status: p.seller.status, phone: p.seller.user?.phone }
      : undefined,
    sellerPrice: moneyDto(a.sellerPrice),
    marketValue: moneyDto(a.marketValue),
    bidFee: moneyDto(a.bidFee),
    minBid: moneyDto(a.minBid),
    maxBid: moneyDto(a.maxBid),
    bidStep: moneyDto(a.bidStep),
    minPaidBids: a.minPaidBids,
    maxBidsPerUser: a.maxBidsPerUser,
    bidCount: a.bidCount,
    // Bid fees collected so far (paid bids × fee); useful to see whether fees cover the seller price.
    feesCollected: moneyDto(a.bidFee * BigInt(a.bidCount)),
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    isFeatured: a.isFeatured,
    viewCount: a.viewCount,
    cancelledReason: a.cancelledReason,
    closedAt: a.closedAt,
    result: a.result
      ? {
          outcome: a.result.outcome,
          status: a.result.status,
          finalPrice: moneyDto(a.result.finalPrice),
          totalDue: moneyDto(a.result.totalDue),
          paymentDeadline: a.result.paymentDeadline,
          paidAt: a.result.paidAt,
        }
      : null,
    createdAt: a.createdAt,
  };
}

// ───────────────────────────── Seller ─────────────────────────────

export async function createAuction(seller, input, { actorId, req }) {
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    include: { category: true, auctions: { include: { result: { select: { outcome: true } } } }, _count: { select: { images: true } } },
  });
  if (!product || product.sellerId !== seller.id) throw notFound('PRODUCT_NOT_FOUND', 'Listing not found');
  if (product.status !== 'APPROVED') throw conflict('PRODUCT_NOT_APPROVED', 'The listing must be approved before it can be auctioned');
  const lock = editLock(product);
  if (lock) throw conflict(lock.code === 'PRODUCT_LOCKED' ? 'AUCTION_ALREADY_EXISTS' : lock.code, lock.code === 'PRODUCT_LOCKED' ? 'This listing already has an auction in progress' : lock.message);

  const [rules, luba] = await Promise.all([getSetting('auction.rules'), getSetting('auction.lowestUniqueBid')]);
  const sellerPrice = etbToMinor(input.sellerPrice);
  const draft = {
    sellerPrice,
    marketValue: input.marketValue ? etbToMinor(input.marketValue) : null,
    startsAt: input.startsAt,
    durationMinutes: input.durationMinutes,
    now: new Date(),
    rules,
  };
  const errors = validateAuctionDraft(draft);
  if (errors.length) throw badRequest('VALIDATION_FAILED', 'Some fields are invalid', errors);
  // Bidding terms start from the defaults; an admin can adjust them before approving.
  const terms = defaultBiddingTerms({ sellerPrice, categoryBidFee: product.category.defaultBidFee, settings: luba });
  const endsAt = new Date(draft.startsAt.getTime() + draft.durationMinutes * 60_000);

  const created = await prisma.$transaction(async (tx) => {
    // Lock the product so two quick submissions cannot create two auctions for one item.
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${product.id} FOR UPDATE`;
    const active = await tx.auction.count({ where: { productId: product.id, status: { in: ['PENDING_APPROVAL', 'SCHEDULED', 'LIVE'] } } });
    if (active) throw conflict('AUCTION_ALREADY_EXISTS', 'This listing already has an auction in progress');
    const a = await tx.auction.create({
      data: {
        productId: product.id,
        status: 'PENDING_APPROVAL',
        sellerPrice: draft.sellerPrice,
        marketValue: draft.marketValue,
        ...terms,
        startsAt: draft.startsAt,
        endsAt,
      },
    });
    await recordAudit({ actorId, action: 'auction.create', entity: 'auction', entityId: a.id, after: { productId: product.id }, req }, tx);
    return a;
  });
  return getAuctionManaged(created.id);
}

export async function listSellerAuctions(seller, { status, page, pageSize }) {
  const where = { product: { sellerId: seller.id }, ...(status && { status }) };
  const [total, rows] = await Promise.all([
    prisma.auction.count({ where }),
    prisma.auction.findMany({ where, include: INCLUDE, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return { data: rows.map((a) => presentManaged(a)), meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}

/** Seller's view of one auction. Bid amounts appear only after the close, like for everyone else. */
export async function getSellerAuction(seller, auctionId) {
  const a = await prisma.auction.findUnique({ where: { id: BigInt(auctionId) }, include: INCLUDE });
  if (!a || a.product.sellerId !== seller.id) throw notFound('AUCTION_NOT_FOUND', 'Auction not found');
  if (a.status !== 'CLOSED') return { ...presentManaged(a), bids: null };
  const bids = await prisma.bid.findMany({ where: { auctionId: a.id, status: 'ACTIVE' }, include: { bidder: { select: { firstName: true } } } });
  const secret = aliasSecret();
  return {
    ...presentManaged(a),
    bids: rankBids(bids).slice(0, 100).map((b) => ({
      id: b.id.toString(),
      amount: moneyDto(b.amount),
      unique: b.unique,
      bidderAlias: bidderAlias(b.bidder.firstName, a.id, b.bidderId, secret),
      createdAt: b.activatedAt,
    })),
  };
}

export const cancelSellerAuction = (seller, auctionId, reason, { actorId, req }) =>
  cancelAuction(auctionId, { reason, actorId, asAdmin: false, sellerId: seller.id, req }).then(() => getAuctionManaged(auctionId));

// ───────────────────────────── Admin ─────────────────────────────

export async function getAuctionManaged(auctionId, opts) {
  const a = await prisma.auction.findUnique({ where: { id: BigInt(auctionId) }, include: INCLUDE });
  if (!a) throw notFound('AUCTION_NOT_FOUND', 'Auction not found');
  return presentManaged(a, opts);
}

export async function listAuctionsAdmin({ status, q, sellerId, page, pageSize }) {
  const where = {
    ...(status && { status }),
    ...(sellerId && { product: { sellerId } }),
    ...(q && { product: { ...(sellerId && { sellerId }), title: { contains: q } } }),
  };
  const [total, rows] = await Promise.all([
    prisma.auction.count({ where }),
    prisma.auction.findMany({
      where,
      include: INCLUDE,
      // The approval queue is first come, first served.
      orderBy: status === 'PENDING_APPROVAL' ? { createdAt: 'asc' } : { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { data: rows.map((a) => presentManaged(a, { withSellerContact: true })), meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}

export async function approveAuction(auctionId, { actorId, req }) {
  const updated = await prisma.$transaction(async (tx) => {
    const s = await lockAuction(tx, auctionId);
    if (s.status !== 'PENDING_APPROVAL') throw conflict('AUCTION_NOT_PENDING', `This auction is ${s.status.toLowerCase().replace('_', ' ')}`);
    const product = await tx.product.findUnique({ where: { id: s.productId }, include: { seller: true } });
    if (product.status !== 'APPROVED') throw conflict('PRODUCT_NOT_APPROVED', 'The listing is no longer approved');
    if (product.seller.status !== 'APPROVED') throw conflict('SELLER_NOT_APPROVED', 'The seller is not approved');

    const when = scheduleOnApproval({ startsAt: s.startsAt, endsAt: s.endsAt, now: s.now });
    const a = await tx.auction.update({
      where: { id: s.id },
      data: {
        status: when.startsNow ? 'LIVE' : 'SCHEDULED',
        startsAt: when.startsAt,
        endsAt: when.endsAt,
        approvedById: BigInt(actorId),
        approvedAt: s.now,
      },
    });
    await notify(s.sellerUserId, 'AUCTION_APPROVED', { title: s.title }, { auctionId: s.id }, tx);
    await recordAudit({ actorId, action: 'auction.approve', entity: 'auction', entityId: s.id, after: { status: a.status, startsAt: a.startsAt, endsAt: a.endsAt }, req }, tx);
    return a;
  });
  await scheduleAuctionJobs(updated);
  if (updated.status === 'LIVE') emitToAuction(updated.id, 'auction:started', { auctionId: updated.id, endsAt: updated.endsAt });
  return getAuctionManaged(updated.id, { withSellerContact: true });
}

export async function rejectAuction(auctionId, reason, { actorId, req }) {
  await prisma.$transaction(async (tx) => {
    const s = await lockAuction(tx, auctionId);
    if (s.status !== 'PENDING_APPROVAL') throw conflict('AUCTION_NOT_PENDING', `This auction is ${s.status.toLowerCase().replace('_', ' ')}`);
    await tx.auction.update({ where: { id: s.id }, data: { status: 'CANCELLED', cancelledReason: reason, cancelledById: BigInt(actorId) } });
    await notify(s.sellerUserId, 'AUCTION_REJECTED', { title: s.title, reason }, { auctionId: s.id }, tx);
    await recordAudit({ actorId, action: 'auction.reject', entity: 'auction', entityId: s.id, after: { reason }, req }, tx);
  });
  return getAuctionManaged(auctionId, { withSellerContact: true });
}

export const cancelAuctionAdmin = (auctionId, reason, { actorId, req }) =>
  cancelAuction(auctionId, { reason, actorId, asAdmin: true, req }).then(() => getAuctionManaged(auctionId, { withSellerContact: true }));

export async function patchAuctionAdmin(auctionId, input, { actorId, req }) {
  await prisma.$transaction(async (tx) => {
    const s = await lockAuction(tx, auctionId);
    if (['CLOSED', 'CANCELLED'].includes(s.status)) throw conflict('AUCTION_ALREADY_FINISHED', 'This auction has finished');
    const data = {};
    if (input.isFeatured !== undefined) data.isFeatured = input.isFeatured;
    const termKeys = ['bidFee', 'minBid', 'maxBid', 'bidStep', 'minPaidBids', 'maxBidsPerUser'];
    if (termKeys.some((k) => input[k] !== undefined)) {
      // Changing the rules once people have paid fees would be unfair to them.
      if (!['PENDING_APPROVAL', 'SCHEDULED'].includes(s.status) || s.bidCount > 0 || s.now >= s.startsAt) {
        throw conflict('TERMS_LOCKED', 'Bidding terms can only change before bidding opens');
      }
      const money = (k) => (input[k] !== undefined ? etbToMinor(input[k]) : s[k]);
      const terms = {
        bidFee: money('bidFee'),
        minBid: money('minBid'),
        maxBid: money('maxBid'),
        bidStep: money('bidStep'),
        minPaidBids: input.minPaidBids ?? s.minPaidBids,
        maxBidsPerUser: input.maxBidsPerUser ?? s.maxBidsPerUser,
      };
      const errors = validateBiddingTerms(terms);
      if (errors.length) throw badRequest('VALIDATION_FAILED', 'Some fields are invalid', errors);
      Object.assign(data, terms);
    }
    await tx.auction.update({ where: { id: s.id }, data });
    await recordAudit({ actorId, action: 'auction.admin_update', entity: 'auction', entityId: s.id, after: input, req }, tx);
  });
  return getAuctionManaged(auctionId, { withSellerContact: true });
}

/** Bid monitor: every bid with the real bidder, for fraud review. Admin only (amounts are secret to everyone else until the close). */
export async function listBidsAdmin({ auctionId, userId, page, pageSize }) {
  const where = { ...(auctionId && { auctionId }), ...(userId && { bidderId: userId }) };
  const [total, rows] = await Promise.all([
    prisma.bid.count({ where }),
    prisma.bid.findMany({
      where,
      orderBy: { id: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        bidder: { select: { id: true, firstName: true, lastName: true, phone: true, status: true } },
        auction: { select: { id: true, status: true, product: { select: { title: true, seller: { select: { userId: true } } } } } },
      },
    }),
  ]);
  return {
    data: rows.map((b) => ({
      id: b.id.toString(),
      amount: moneyDto(b.amount),
      createdAt: b.createdAt,
      ip: b.ip,
      status: b.status,
      activatedAt: b.activatedAt,
      bidder: { id: b.bidder.id.toString(), name: `${b.bidder.firstName} ${b.bidder.lastName}`, phone: b.bidder.phone, status: b.bidder.status },
      auction: { id: b.auction.id.toString(), status: b.auction.status, title: b.auction.product.title },
    })),
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}
