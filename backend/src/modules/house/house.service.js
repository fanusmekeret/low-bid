import { randomBytes } from 'node:crypto';
import { prisma } from '../../config/prisma.js';

// LOW BID is the only seller. Every product belongs to one "house" seller profile, owned by a
// system account that cannot sign in (random password hash, SUSPENDED). It exists so listings
// keep an owner ("Sold by LOW BID") and so bidding can tell the house apart from bidders.

export const HOUSE_PHONE = '+251999000000';
const HOUSE = { businessName: 'LOW BID', city: 'Addis Ababa', bio: 'Every item is listed, priced and delivered by LOW BID.' };

let cached = null;

/** Creates the house account and seller profile if missing. Idempotent; the seed calls it. */
export async function ensureHouseSeller(db = prisma) {
  const user = await db.user.upsert({
    where: { phone: HOUSE_PHONE },
    update: {},
    create: {
      phone: HOUSE_PHONE,
      // Not a valid Argon2 hash, so no password ever matches.
      passwordHash: `!locked-${randomBytes(16).toString('hex')}`,
      firstName: 'LOW',
      lastName: 'BID',
      status: 'SUSPENDED',
    },
  });
  const profile = await db.sellerProfile.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, ...HOUSE, businessType: 'COMPANY', status: 'APPROVED', approvedAt: new Date() },
  });
  cached = profile;
  return profile;
}

/** The house seller profile (cached after the first call). */
export async function getHouseSeller() {
  if (cached) return cached;
  return ensureHouseSeller();
}

/** For tests that wipe the database. */
export const resetHouseSellerCache = () => { cached = null; };
