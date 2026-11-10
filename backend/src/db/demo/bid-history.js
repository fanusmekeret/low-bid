const MINUTE = 60_000;

// Deterministic pseudo-random numbers so every run produces the same bid history.
export function rng(seedText) {
  let h = 2166136261;
  for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds a plausible lowest-unique-bid history. People bid small amounts (mostly under
 * 100 ETB, in whole birr or with cents), several people land on the same popular amounts
 * (so those are not unique), and nobody bids the same amount twice.
 * Returns bids ready for createMany (status ACTIVE, as if their fees were paid).
 */
export function buildBids(item, bidders, startsAt, lastBidAt, random) {
  const count = item.bids * 4; // lowest-unique-bid auctions get many small bids
  const span = Math.max(lastBidAt.getTime() - startsAt.getTime(), MINUTE);
  const times = Array.from({ length: count }, () => startsAt.getTime() + 1000 + random() * (span - 1000)).sort((a, b) => a - b);
  const popular = [100n, 500n, 1000n, 1500n, 2000n, 5000n, 9900n]; // 1, 5, 10, 15, 20, 50, 99 ETB
  const used = new Map(bidders.map((b) => [b.id, new Set()]));

  const bids = [];
  for (const [i, t] of times.entries()) {
    const bidder = bidders[Math.floor(random() * bidders.length)];
    const mine = used.get(bidder.id);
    let amount;
    for (let tries = 0; tries < 20; tries += 1) {
      const r = random();
      amount = r < 0.3
        ? popular[Math.floor(random() * popular.length)]
        : r < 0.7
          ? BigInt(1 + Math.floor(random() * 99)) * 100n // whole birr 1–99
          : BigInt(1 + Math.floor(random() * 9_999)); // 0.01–99.99 ETB with cents
      if (!mine.has(amount)) break;
    }
    if (mine.has(amount)) continue;
    mine.add(amount);
    const at = new Date(t);
    bids.push({ bidderId: bidder.id, amount, status: 'ACTIVE', activatedAt: at, createdAt: at, idempotencyKey: `demo-${item.key}-${i + 1}` });
  }
  return bids;
}
