import { prisma } from '../../config/prisma.js';
import { scheduleAuctionJobs } from '../../jobs/queue.js';
import { imageUrls } from '../../services/media/productImages.js';
import { emitToAuction } from '../../sockets/realtime.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { etbToMinor, moneyDto } from '../../utils/money.js';
import { recordAudit } from '../audit/audit.service.js';
import { editLock } from '../products/products.rules.js';
import { getSetting } from '../settings/settings.service.js';
import { lockAuction } from './auction.lock.js';
import { defaultBiddingTerms, validateAuctionDraft, validateBiddingTerms } from './auction.rules.js';
import { cancelAuction } from './lifecycle.service.js';

// LOW BID schedules every auction itself (permission auction:manage). There is no approval
// step: creating an auction schedules it, or starts it straight away if the start time is now.

const INCLUDE = {
  product: { include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 }, category: true } },
  result: true,
};

/** Staff view: item cost, bidding terms and money collected. Never bid amounts while bidding is open. */
function presentManaged(a) {
  const p = a.product;
  const cover = p.images?.[0];
  const fees = a.bidFee * BigInt(a.bidCount);
  const winning = a.result?.finalPrice ?? 0n;
  return {
    id: a.id.toString(),
    status: a.status,
    product: { id: p.id.toString(), title: p.title, status: p.status, coverImage: cover ? imageUrls(cover.key) : null, category: p.category?.slug },
    itemCost: moneyDto(a.itemCost),
    marketValue: moneyDto(a.marketValue),
    bidFee: moneyDto(a.bidFee),
    minBid: moneyDto(a.minBid),
    maxBid: moneyDto(a.maxBid),
    bidStep: moneyDto(a.bidStep),
    minPaidBids: a.minPaidBids,
    maxBidsPerUser: a.maxBidsPerUser,
    bidCount: a.bidCount,
    // Paid bids × fee, plus the winning bid once sold: compare with the item cost.
    feesCollected: moneyDto(fees),
    grossTakings: moneyDto(fees + winning),
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    isFeatured: a.isFeatured,
    viewCount: a.viewCount,
    cancelledReason: a.cancelledReason,
    closedAt: a.closedAt,
    result: a.result
      ? {
          id: a.result.id.toString(),
          outcome: a.result.outcome,
          status: a.result.status,
          finalPrice: moneyDto(a.result.finalPrice),
          totalDue: moneyDto(a.result.totalDue),
          paymentDeadline: a.result.paymentDeadline,
          paidAt: a.result.paidAt,
          fulfilledAt: a.result.fulfilledAt,
        }
      : null,
    createdAt: a.createdAt,
  };
}

export async function getAuctionManaged(auctionId) {
  const a = await prisma.auction.findUnique({ where: { id: BigInt(auctionId) }, include: INCLUDE });
  if (!a) throw notFound('AUCTION_NOT_FOUND', 'Auction not found');
  return presentManaged(a);
}

/**
 * Creates and schedules an auction for a published listing. Bidding terms start from the
 * defaults (category or platform fee, bids from 0.01 ETB up to the item cost) and can be set here.
 */
export async function createAuction(input, { actorId, req }) {
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    include: { category: true, auctions: { include: { result: { select: { outcome: true } } } } },
  });
  if (!product) throw notFound('PRODUCT_NOT_FOUND', 'Listing not found');
  if (product.status !== 'APPROVED') throw conflict('PRODUCT_NOT_PUBLISHED', 'Publish the listing before auctioning it');
  const lock = editLock(product);
  if (lock) throw conflict(lock.code === 'PRODUCT_LOCKED' ? 'AUCTION_ALREADY_EXISTS' : lock.code, lock.code === 'PRODUCT_LOCKED' ? 'This listing already has an auction in progress' : lock.message);

  const [rules, luba] = await Promise.all([getSetting('auction.rules'), getSetting('auction.lowestUniqueBid')]);
  const itemCost = etbToMinor(input.itemCost);
  const draft = {
    itemCost,
    marketValue: input.marketValue ? etbToMinor(input.marketValue) : null,
    startsAt: input.startsAt,
    durationMinutes: input.durationMinutes,
    now: new Date(),
    rules,
  };
  const errors = validateAuctionDraft(draft);
  const defaults = defaultBiddingTerms({ itemCost, categoryBidFee: product.category.defaultBidFee, settings: luba });
  const terms = {
    bidFee: input.bidFee ? etbToMinor(input.bidFee) : defaults.bidFee,
    minBid: input.minBid ? etbToMinor(input.minBid) : defaults.minBid,
    maxBid: input.maxBid ? etbToMinor(input.maxBid) : defaults.maxBid,
    bidStep: input.bidStep ? etbToMinor(input.bidStep) : defaults.bidStep,
    minPaidBids: input.minPaidBids ?? defaults.minPaidBids,
    maxBidsPerUser: input.maxBidsPerUser ?? defaults.maxBidsPerUser,
  };
  errors.push(...validateBiddingTerms(terms));
  if (errors.length) throw badRequest('VALIDATION_FAILED', 'Some fields are invalid', errors);

  const created = await prisma.$transaction(async (tx) => {
    // Lock the product so two quick submissions cannot create two auctions for one item.
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${product.id} FOR UPDATE`;
    const active = await tx.auction.count({ where: { productId: product.id, status: { in: ['SCHEDULED', 'LIVE'] } } });
    if (active) throw conflict('AUCTION_ALREADY_EXISTS', 'This listing already has an auction in progress');
    const [{ now }] = await tx.$queryRaw`SELECT UTC_TIMESTAMP(3) AS now`;
    const startsNow = draft.startsAt.getTime() <= new Date(now).getTime();
    const startsAt = startsNow ? new Date(now) : draft.startsAt;
    const a = await tx.auction.create({
      data: {
        productId: product.id,
        status: startsNow ? 'LIVE' : 'SCHEDULED',
        itemCost: draft.itemCost,
        marketValue: draft.marketValue,
        ...terms,
        isFeatured: Boolean(input.isFeatured),
        startsAt,
        endsAt: new Date(startsAt.getTime() + draft.durationMinutes * 60_000),
        approvedById: BigInt(actorId),
        approvedAt: new Date(now),
      },
    });
    await recordAudit({ actorId, action: 'auction.create', entity: 'auction', entityId: a.id, after: { productId: product.id, status: a.status }, req }, tx);
    return a;
  });
  await scheduleAuctionJobs(created);
  if (created.status === 'LIVE') emitToAuction(created.id, 'auction:started', { auctionId: created.id, endsAt: created.endsAt });
  return getAuctionManaged(created.id);
}

export async function listAuctionsAdmin({ status, q, page, pageSize }) {
  const where = { ...(status && { status }), ...(q && { product: { title: { contains: q } } }) };
  const [total, rows] = await Promise.all([
    prisma.auction.count({ where }),
    prisma.auction.findMany({
      where,
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { data: rows.map((a) => presentManaged(a)), meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}

export const cancelAuctionAdmin = (auctionId, reason, { actorId, req }) =>
  cancelAuction(auctionId, { reason, actorId, req }).then(() => getAuctionManaged(auctionId));

export async function patchAuctionAdmin(auctionId, input, { actorId, req }) {
  await prisma.$transaction(async (tx) => {
    const s = await lockAuction(tx, auctionId);
    if (['CLOSED', 'CANCELLED'].includes(s.status)) throw conflict('AUCTION_ALREADY_FINISHED', 'This auction has finished');
    const data = {};
    if (input.isFeatured !== undefined) data.isFeatured = input.isFeatured;
    const termKeys = ['bidFee', 'minBid', 'maxBid', 'bidStep', 'minPaidBids', 'maxBidsPerUser'];
    if (termKeys.some((k) => input[k] !== undefined)) {
      // Changing the rules once people have paid fees would be unfair to them.
      if (s.status !== 'SCHEDULED' || s.bidCount > 0 || s.now >= s.startsAt) {
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
  return getAuctionManaged(auctionId);
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
        auction: { select: { id: true, status: true, product: { select: { title: true } } } },
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
