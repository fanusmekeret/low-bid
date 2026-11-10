import type { Auction, Product, ProductImage, ProductSpec, Category, User } from "@prisma/client";
import { money } from "../../utils/money.js";
import { minimumNextBid } from "../bids/rules.js";

type CardInput = Auction & { product: Product & { images: ProductImage[] } };

/** Auction card: photo, title, three headline specs, condition, location, bid count, countdown. Never a price. */
export function auctionCard(a: CardInput) {
  return {
    id: a.id.toString(),
    title: a.product.title,
    image: a.product.images[0]?.storageKey ?? null,
    headline: (a.product.headline as string[]).slice(0, 3),
    condition: a.product.condition,
    location: a.product.location,
    status: a.status,
    bid_count: a.bidCount,
    starts_at: a.startsAt.toISOString(),
    ends_at: a.endsAt.toISOString(),
    is_featured: a.isFeatured,
  };
}

type DetailInput = Auction & {
  product: Product & { images: ProductImage[]; specs: ProductSpec[]; category: Category; seller: Pick<User, "id" | "fullName"> };
};

/** Auction page: prices and the full grouped spec sheet live here only. */
export function auctionDetail(a: DetailInput, viewerId?: bigint) {
  const groups = new Map<string, { label: string; value: string }[]>();
  for (const s of [...a.product.specs].sort((x, y) => x.sortOrder - y.sortOrder)) {
    if (!groups.has(s.groupName)) groups.set(s.groupName, []);
    groups.get(s.groupName)!.push({ label: s.label, value: s.value });
  }
  return {
    ...auctionCard(a),
    description: a.product.description,
    images: a.product.images.sort((x, y) => x.sortOrder - y.sortOrder).map((i) => i.storageKey),
    category: { id: a.product.category.id, slug: a.product.category.slug, name_en: a.product.category.nameEn, name_am: a.product.category.nameAm },
    seller: { id: a.product.seller.id.toString(), name: a.product.seller.fullName },
    specs: [...groups.entries()].map(([group, items]) => ({ group, items })),
    start_price: money(a.startPrice),
    current_bid: money(a.currentPrice),
    min_increment: money(a.minIncrement),
    next_min_bid: money(minimumNextBid(a)),
    has_reserve: a.reservePrice !== null,
    reserve_met: a.reservePrice === null ? null : (a.currentPrice ?? 0n) >= a.reservePrice,
    deposit: a.depositMinor > 0n ? money(a.depositMinor) : null,
    is_leading: viewerId !== undefined && a.currentWinnerId === viewerId,
    extension_count: a.extensionCount,
  };
}
