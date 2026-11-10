import { moneyDto } from '../../utils/money.js';

// Two shapes on purpose:
//   card   → lists (home rails, category, search, watchlist, my bids): specs + countdown, NO prices
//   detail → the auction page: bid fee, allowed bid range, item value and the full spec sheet.
//            Bid amounts are never here while bidding is open (they are secret until the close).
// Keeping prices out of the card shape at the API level means no screen can show them by accident.

const imageKeys = (product) => (product.images ?? []).map((i) => i.key);

// `imageUrls(key)` → { sm, md, lg } comes from services/media/productImages.js. It is passed in
// (not imported) so this module stays free of storage configuration and is easy to test.
function requireUrls(imageUrls) {
  if (typeof imageUrls !== 'function') throw new Error('presentAuction* needs { imageUrls }');
  return imageUrls;
}

function timing(auction) {
  return {
    status: auction.status,
    startsAt: auction.startsAt,
    endsAt: auction.endsAt,
  };
}

/**
 * @param {object} auction auction row with product (+ images, category, seller) included
 * @param {{ imageUrls: (key: string) => { sm: string, md: string, lg: string } }} media
 */
export function presentAuctionCard(auction, { imageUrls }) {
  const urls = requireUrls(imageUrls);
  const { product } = auction;
  const attrs = product.attributes ?? {};
  return {
    id: auction.id.toString(),
    title: product.title,
    condition: product.condition,
    location: product.location,
    highlights: Array.isArray(attrs.highlights) ? attrs.highlights.slice(0, 3) : [],
    coverImage: imageKeys(product)[0] ? urls(imageKeys(product)[0]) : null,
    category: product.category ? { slug: product.category.slug, nameEn: product.category.nameEn, nameAm: product.category.nameAm } : null,
    isFeatured: auction.isFeatured,
    bidCount: auction.bidCount,
    ...timing(auction),
  };
}

/** @param {object} auction auction row with product (+ images, category, seller) included */
export function presentAuctionDetail(auction, { imageUrls } = {}) {
  const { product } = auction;
  const attrs = product.attributes ?? {};
  return {
    ...presentAuctionCard(auction, { imageUrls }),
    description: product.description,
    images: imageKeys(product).map(requireUrls(imageUrls)),
    specs: Array.isArray(attrs.specs) ? attrs.specs : [],
    seller: product.seller
      ? {
          id: product.seller.id.toString(),
          businessName: product.seller.businessName,
          city: product.seller.city,
          rating: product.seller.ratingAvg / 100,
          ratingCount: product.seller.ratingCount,
        }
      : null,
    // How bidding works on this auction: every bid costs bidFee; amounts from minBid to maxBid
    // in steps of bidStep; the lowest amount only one person bid wins.
    bidding: {
      bidFee: moneyDto(auction.bidFee),
      minBid: moneyDto(auction.minBid),
      maxBid: moneyDto(auction.maxBid),
      bidStep: moneyDto(auction.bidStep),
      maxBidsPerUser: auction.maxBidsPerUser,
      minPaidBids: auction.minPaidBids,
    },
    marketValue: moneyDto(auction.marketValue),
  };
}
