// Loads demo sellers, bidders, products, auctions and bids for development and demos.
//   bun run db:seed:demo            # replace previous demo data
// Re-running wipes earlier demo data first (only accounts with demo phone numbers +25190000…).
// Refuses to run when NODE_ENV=production.
import { randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { hashPassword } from '../modules/auth/password.js';
import { ROLES } from '../modules/rbac/permissions.js';
import { applyBasisPoints, etbToMinor, minorToEtb } from '../utils/money.js';
import { closeOutcome, defaultBiddingTerms, pickWinner, rankBids } from '../modules/auctions/auction.rules.js';
import { SETTING_DEFINITIONS } from '../modules/settings/settings.definitions.js';
import { deleteProductImageFiles, storeProductImages } from '../services/media/productImages.js';
import { normalizeEthiopianPhone } from '../utils/phone.js';
import { buildBids, rng } from './demo/bid-history.js';
import { DEMO_BIDDERS, DEMO_ITEMS, DEMO_SELLERS } from './demo/demo-catalog.js';
import { makeDemoPhoto } from './demo/demo-photos.js';
import { DEMO_SPECS } from './demo/demo-specs.js';
import { seedCategories, seedRbac, seedSettings } from './seed.js';

const DEMO_PHONE_PREFIX = '+25190000';
const MINUTE = 60_000;

function phoneOf(local) {
  const phone = normalizeEthiopianPhone(local);
  if (!phone?.startsWith(DEMO_PHONE_PREFIX)) throw new Error(`Demo phone ${local} must start with ${DEMO_PHONE_PREFIX}`);
  return phone;
}

async function wipeDemoData() {
  const users = await prisma.user.findMany({ where: { phone: { startsWith: DEMO_PHONE_PREFIX } }, select: { id: true } });
  if (users.length === 0) return 0;
  const userIds = users.map((u) => u.id);
  const sellerIds = (await prisma.sellerProfile.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((s) => s.id);
  const productIds = (await prisma.product.findMany({ where: { sellerId: { in: sellerIds } }, select: { id: true } })).map((p) => p.id);
  const auctionIds = (await prisma.auction.findMany({ where: { productId: { in: productIds } }, select: { id: true } })).map((a) => a.id);
  const imageKeys = (await prisma.productImage.findMany({ where: { productId: { in: productIds } }, select: { key: true } })).map((i) => i.key);
  const paymentIds = (await prisma.payment.findMany({
    where: { OR: [{ userId: { in: userIds } }, { auctionId: { in: auctionIds } }] },
    select: { id: true },
  })).map((p) => p.id);
  const payoutIds = (await prisma.sellerPayout.findMany({ where: { sellerId: { in: sellerIds } }, select: { id: true } })).map((p) => p.id);
  // Money records first: they reference results, bids and users.
  await prisma.$transaction([
    prisma.transaction.deleteMany({ where: { OR: [{ paymentId: { in: paymentIds } }, { payoutId: { in: payoutIds } }] } }),
    prisma.refund.deleteMany({ where: { paymentId: { in: paymentIds } } }),
    prisma.commission.deleteMany({ where: { paymentId: { in: paymentIds } } }),
    prisma.sellerPayout.deleteMany({ where: { id: { in: payoutIds } } }),
    prisma.payment.deleteMany({ where: { id: { in: paymentIds } } }),
  ]);

  await prisma.$transaction([
    prisma.bid.deleteMany({ where: { OR: [{ auctionId: { in: auctionIds } }, { bidderId: { in: userIds } }] } }),
    prisma.auctionWatchlist.deleteMany({ where: { OR: [{ auctionId: { in: auctionIds } }, { userId: { in: userIds } }] } }),
    prisma.auctionResult.deleteMany({ where: { auctionId: { in: auctionIds } } }),
    prisma.auction.deleteMany({ where: { id: { in: auctionIds } } }),
    prisma.product.deleteMany({ where: { id: { in: productIds } } }), // images cascade
    prisma.sellerProfile.deleteMany({ where: { id: { in: sellerIds } } }), // verifications cascade
    prisma.notification.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.user.deleteMany({ where: { id: { in: userIds } } }), // roles, tokens, OTPs, devices cascade
  ]);
  await deleteProductImageFiles(imageKeys.filter((k) => k.startsWith('products/')));
  return users.length;
}

async function createUser({ phone, firstName, lastName }, roleCodes, passwordHash) {
  const roles = await prisma.role.findMany({ where: { code: { in: roleCodes } } });
  return prisma.user.create({
    data: {
      phone: phoneOf(phone),
      passwordHash,
      firstName,
      lastName,
      phoneVerifiedAt: new Date(),
      roles: { create: roles.map((r) => ({ roleId: r.id })) },
    },
  });
}

function scheduleTimes(schedule, now) {
  if (schedule.live) {
    const startsAt = new Date(now - schedule.live.startedAgo * MINUTE);
    const endsAt = new Date(now + schedule.live.endsIn * MINUTE);
    return { status: 'LIVE', startsAt, endsAt };
  }
  if (schedule.upcoming) {
    const startsAt = new Date(now + schedule.upcoming.startsIn * MINUTE);
    return { status: 'SCHEDULED', startsAt, endsAt: new Date(startsAt.getTime() + schedule.upcoming.duration * MINUTE) };
  }
  if (schedule.closed) {
    const endsAt = new Date(now - schedule.closed.endedAgo * MINUTE);
    return { status: 'CLOSED', startsAt: new Date(endsAt.getTime() - schedule.closed.duration * MINUTE), endsAt };
  }
  throw new Error('Unknown schedule');
}

async function main() {
  if (env.isProduction) throw new Error('Refusing to load demo data with NODE_ENV=production');

  await seedRbac();
  await seedCategories();
  await seedSettings();

  const removed = await wipeDemoData();
  if (removed) console.log(`• removed ${removed} previous demo accounts and their listings`);

  const password = process.env.DEMO_USER_PASSWORD || `demo-${randomBytes(4).toString('hex')}`;
  const passwordHash = await hashPassword(password);

  const sellers = new Map();
  for (const s of DEMO_SELLERS) {
    const user = await createUser(s, [ROLES.BUYER, ROLES.BIDDER, ROLES.SELLER], passwordHash);
    const profile = await prisma.sellerProfile.create({
      data: {
        userId: user.id,
        businessName: s.businessName,
        businessType: s.businessType,
        city: s.city,
        address: s.address,
        bio: s.bio,
        status: 'APPROVED',
        approvedAt: new Date(),
        ratingAvg: 440 + (s.key.length * 7) % 55, // 4.40–4.94
        ratingCount: 12 + s.key.length * 3,
      },
    });
    sellers.set(s.key, profile);
  }

  const bidders = [];
  for (const b of DEMO_BIDDERS) bidders.push(await createUser(b, [ROLES.BUYER, ROLES.BIDDER], passwordHash));

  const categories = new Map((await prisma.category.findMany()).map((c) => [c.slug, c]));
  const fees = (await prisma.systemSetting.findUnique({ where: { key: 'fees.commission' } }))?.value ?? { buyerPremiumBp: 0 };
  const rules = (await prisma.systemSetting.findUnique({ where: { key: 'auction.rules' } }))?.value ?? { paymentDeadlineHours: 48 };
  const luba = (await prisma.systemSetting.findUnique({ where: { key: 'auction.lowestUniqueBid' } }))?.value ?? SETTING_DEFINITIONS['auction.lowestUniqueBid'].default;

  const now = Date.now();
  const summary = [];
  const liveAuctionIds = [];

  for (const item of DEMO_ITEMS) {
    const seller = sellers.get(item.seller);
    const category = categories.get(item.category);
    if (!seller || !category) throw new Error(`Bad seller or category on ${item.key}`);
    if (!DEMO_SPECS[item.key]) throw new Error(`No spec sheet for ${item.key}`);
    const random = rng(item.key);
    const { status, startsAt, endsAt } = scheduleTimes(item.schedule, now);

    const product = await prisma.product.create({
      data: {
        sellerId: seller.id,
        categoryId: category.id,
        title: item.title,
        description: item.description,
        condition: item.condition,
        location: item.location,
        attributes: DEMO_SPECS[item.key], // { highlights, specs }
        status: 'APPROVED',
      },
    });

    // Three generated photos per item, stored through the real image pipeline (3 WebP sizes each).
    const photos = await Promise.all([0, 1, 2].map(async (view) => ({ buffer: await makeDemoPhoto(item, view), originalname: `${item.key}-${view + 1}.png` })));
    const stored = await storeProductImages(product.id, photos);
    await prisma.productImage.createMany({ data: stored.map((img, i) => ({ productId: product.id, key: img.key, width: img.width, height: img.height, sortOrder: i })) });

    const lastBidAt = status === 'LIVE' ? new Date(now - 20_000) : endsAt;
    const sellerPrice = etbToMinor(item.priceEtb);
    const terms = defaultBiddingTerms({ sellerPrice, categoryBidFee: category.defaultBidFee, settings: luba });
    // Demo bids are created as already paid (ACTIVE) without fee payment records.
    const bids = item.bids > 0 && status !== 'SCHEDULED' ? buildBids(item, bidders, startsAt, lastBidAt, random) : [];

    const auction = await prisma.auction.create({
      data: {
        productId: product.id,
        status,
        sellerPrice,
        marketValue: sellerPrice,
        ...terms,
        bidCount: bids.length,
        startsAt,
        endsAt,
        isFeatured: Boolean(item.featured),
        viewCount: 40 + Math.floor(random() * 900),
        approvedAt: new Date(startsAt.getTime() - 60 * MINUTE),
        closedAt: status === 'CLOSED' ? endsAt : null,
      },
    });
    if (bids.length) await prisma.bid.createMany({ data: bids.map((b) => ({ ...b, auctionId: auction.id })) });
    if (status === 'LIVE') liveAuctionIds.push(auction.id);

    let outcome = '';
    let price = null;
    if (status === 'CLOSED') {
      const saved = await prisma.bid.findMany({ where: { auctionId: auction.id, status: 'ACTIVE' } });
      const winning = pickWinner(rankBids(saved), { isEligible: () => true });
      const closed = closeOutcome({ winningBid: winning, paidBids: saved.length, minPaidBids: terms.minPaidBids });
      outcome = closed.outcome;
      price = closed.finalPrice;
      const sold = outcome === 'SOLD';
      const premium = sold ? applyBasisPoints(price, fees.buyerPremiumBp ?? 0) : 0n;
      await prisma.auctionResult.create({
        data: {
          auctionId: auction.id,
          outcome,
          status: sold ? 'AWAITING_PAYMENT' : 'CANCELLED',
          winnerId: sold ? winning.bidderId : null,
          winningBidId: sold ? winning.id : null,
          finalPrice: sold ? price : null,
          buyerPremium: premium,
          totalDue: sold ? price + premium : null,
          paymentDeadline: sold ? new Date(endsAt.getTime() + (rules.paymentDeadlineHours ?? 48) * 60 * MINUTE) : null,
        },
      });
      if (sold) await prisma.auction.update({ where: { id: auction.id }, data: { currentWinnerId: winning.bidderId } });
    }

    summary.push({
      item: item.title.length > 44 ? `${item.title.slice(0, 43)}…` : item.title,
      status: outcome ? `CLOSED (${outcome})` : status,
      bids: bids.length,
      value: `ETB ${minorToEtb(sellerPrice)}`,
      fee: `ETB ${minorToEtb(terms.bidFee)}`,
      won: price === null ? '' : `ETB ${minorToEtb(price)}`,
      ends: status === 'SCHEDULED' ? `starts ${startsAt.toISOString().slice(0, 16)}Z` : endsAt.toISOString().slice(0, 16) + 'Z',
    });
  }

  // The first bidder watches a few live auctions, so the watchlist screen has content.
  await prisma.auctionWatchlist.createMany({
    data: liveAuctionIds.slice(0, 5).map((auctionId) => ({ userId: bidders[0].id, auctionId })),
    skipDuplicates: true,
  });

  console.table(summary);
  console.log(`\n✓ ${DEMO_SELLERS.length} sellers, ${DEMO_BIDDERS.length} bidders, ${DEMO_ITEMS.length} auctions`);
  console.log('\nDemo logins (all share one password):');
  console.log(`  bidder  ${DEMO_BIDDERS[0].phone}  (${DEMO_BIDDERS[0].firstName} ${DEMO_BIDDERS[0].lastName})`);
  console.log(`  seller  ${DEMO_SELLERS[0].phone}  (${DEMO_SELLERS[0].businessName})`);
  console.log(`  password: ${password}${process.env.DEMO_USER_PASSWORD ? ' (from DEMO_USER_PASSWORD)' : ' (random; set DEMO_USER_PASSWORD to choose it)'}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
