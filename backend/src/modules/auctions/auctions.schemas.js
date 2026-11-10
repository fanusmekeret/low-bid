import { z } from 'zod';

const etb = z.string().trim().regex(/^\d{1,13}(\.\d{1,2})?$/, 'Amount in birr, e.g. 145000 or 145000.50');
const id = z.coerce.bigint().positive();

export const createAuctionSchema = z.object({
  productId: id,
  sellerPrice: etb, // what the seller is paid for the item (before commission), whatever the winning bid
  marketValue: etb.optional(), // retail value shown to bidders
  startsAt: z.string().datetime({ offset: true }).transform((v) => new Date(v)),
  durationMinutes: z.number().int().min(1).max(90 * 24 * 60),
});

export const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const adminPatchSchema = z
  .object({
    isFeatured: z.boolean(),
    // Bidding terms (before bidding opens only)
    bidFee: etb,
    minBid: etb,
    maxBid: etb,
    bidStep: etb,
    minPaidBids: z.number().int().min(0).max(100_000),
    maxBidsPerUser: z.number().int().min(1).max(1000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

const page = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) };

export const sellerListQuery = z.object({
  status: z.enum(['PENDING_APPROVAL', 'SCHEDULED', 'LIVE', 'CLOSED', 'CANCELLED']).optional(),
  ...page,
});

export const adminListQuery = z.object({
  status: z.enum(['PENDING_APPROVAL', 'SCHEDULED', 'LIVE', 'CLOSED', 'CANCELLED']).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  sellerId: id.optional(),
  ...page,
});

export const adminBidsQuery = z.object({
  auctionId: id.optional(),
  userId: id.optional(),
  ...page,
});

export const catalogQuery = z.object({
  status: z.enum(['live', 'upcoming', 'ended', 'open']).default('open'),
  category: z.string().trim().regex(/^[a-z0-9-]{1,100}$/).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  condition: z.enum(['NEW', 'LIKE_NEW', 'USED_GOOD', 'USED_FAIR', 'FOR_PARTS']).optional(),
  featured: z.enum(['true']).optional(),
  sort: z.enum(['ending_soon', 'newest', 'most_bids', 'starting_soon']).default('ending_soon'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const historyQuery = z.object({
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const myListQuery = z.object({
  status: z.enum(['active', 'ended']).default('active'),
  ...page,
});
