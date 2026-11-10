import { notFound } from '../../utils/errors.js';

/**
 * Locks one auction row (SELECT … FOR UPDATE) inside a transaction and returns its state
 * plus the database's UTC clock. Concurrent bids, closes and cancels on the same auction
 * queue behind this lock; bids on different auctions run in parallel.
 *
 * `FOR UPDATE OF a` locks only the auction row, not the product or seller rows joined
 * for context, so one seller's many live auctions never block each other.
 */
export async function lockAuction(tx, auctionId) {
  const rows = await tx.$queryRaw`
    SELECT a.id, a.status, a.seller_price AS sellerPrice, a.bid_fee AS bidFee,
           a.min_bid AS minBid, a.max_bid AS maxBid, a.bid_step AS bidStep,
           a.min_paid_bids AS minPaidBids, a.max_bids_per_user AS maxBidsPerUser,
           a.current_winner_id AS currentWinnerId, a.bid_count AS bidCount,
           a.starts_at AS startsAt, a.ends_at AS endsAt, a.product_id AS productId,
           p.title AS title, sp.user_id AS sellerUserId, UTC_TIMESTAMP(3) AS now
    FROM auctions a
    JOIN products p ON p.id = a.product_id
    JOIN seller_profiles sp ON sp.id = p.seller_id
    WHERE a.id = ${BigInt(auctionId)}
    FOR UPDATE OF a`;
  if (!rows.length) throw notFound('AUCTION_NOT_FOUND', 'Auction not found');
  const r = rows[0];
  return {
    ...r,
    // MySQL INT columns arrive as numbers, BIGINT as bigint; normalise the ones we compare.
    bidCount: Number(r.bidCount),
    minPaidBids: Number(r.minPaidBids),
    maxBidsPerUser: Number(r.maxBidsPerUser),
    now: new Date(r.now),
    startsAt: new Date(r.startsAt),
    endsAt: new Date(r.endsAt),
  };
}

/** Prisma / MySQL errors worth retrying: deadlock, write conflict, lock wait timeout. */
export function isRetryableTxError(err) {
  if (!err) return false;
  if (err.code === 'P2034') return true;
  const dbCode = String(err.meta?.code ?? err.meta?.driverAdapterError?.cause?.code ?? '');
  if (dbCode === '1213' || dbCode === '1205') return true;
  return /deadlock|lock wait timeout/i.test(err.message ?? '');
}

export const jitter = (attempt) => new Promise((r) => setTimeout(r, 15 * 2 ** attempt + Math.random() * 25));
