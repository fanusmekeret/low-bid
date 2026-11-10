import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/l10n/app_strings.dart';
import '../../core/theme/app_theme.dart';
import '../models/models.dart';
import 'common.dart';
import 'countdown/auction_countdown.dart';

/// The auction card used everywhere (home rails, search, watchlist, my bids).
/// It shows the photo, countdown, title, up to three spec highlights and the bid count,
/// and never a price: prices appear only on the auction page.
class AuctionCard extends StatelessWidget {
  const AuctionCard({super.key, required this.auction, this.width, this.badge});

  final AuctionCardModel auction;
  final double? width;

  /// Optional overlay in the top-right corner, e.g. "Leading" on My bids.
  final Widget? badge;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final t = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;

    final card = Card(
      child: InkWell(
        onTap: () => context.push('/auctions/${auction.id}'),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          AspectRatio(
            aspectRatio: 4 / 3,
            child: Stack(fit: StackFit.expand, children: [
              Hero(tag: 'auction-image-${auction.id}', child: AppNetworkImage(url: auction.coverImage?.sm)),
              Positioned(
                left: 8,
                top: 8,
                child: AuctionCountdown(
                  startsAt: auction.startsAt,
                  endsAt: auction.endsAt,
                  closed: auction.isClosed,
                  size: CountdownSize.chip,
                ),
              ),
              if (badge != null) Positioned(right: 8, top: 8, child: badge!),
              if (auction.isFeatured && badge == null)
                const Positioned(right: 8, top: 8, child: Icon(Icons.star_rounded, color: AppColors.amber, size: 22)),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(auction.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: t.titleSmall?.copyWith(fontWeight: FontWeight.w700, height: 1.25)),
              if (auction.highlights.isNotEmpty) ...[
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final h in auction.highlights)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(color: scheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(6)),
                        child: Text(h, maxLines: 1, overflow: TextOverflow.ellipsis, style: t.labelSmall),
                      ),
                  ],
                ),
              ],
              const SizedBox(height: 8),
              Text(
                '${s.condition(auction.condition)} · ${auction.location} · ${s.bids(auction.bidCount)}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: t.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
              ),
            ]),
          ),
        ]),
      ),
    );
    return width == null ? card : SizedBox(width: width, child: card);
  }
}

/// Horizontal rail of cards for the home screen.
class AuctionRail extends StatelessWidget {
  const AuctionRail({super.key, required this.items});

  final List<AuctionCardModel> items;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 318,
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        scrollDirection: Axis.horizontal,
        itemCount: items.length,
        separatorBuilder: (_, __) => const SizedBox(width: 12),
        itemBuilder: (_, i) => AuctionCard(auction: items[i], width: 220),
      ),
    );
  }
}

/// Responsive grid of cards: 2 columns on phones, more on tablets.
class AuctionGrid extends StatelessWidget {
  const AuctionGrid({super.key, required this.items, this.badgeFor, this.controller, this.footer});

  final List<AuctionCardModel> items;
  final Widget? Function(AuctionCardModel)? badgeFor;
  final ScrollController? controller;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final columns = width >= 1000 ? 4 : width >= 680 ? 3 : 2;
    return CustomScrollView(controller: controller, physics: const AlwaysScrollableScrollPhysics(), slivers: [
      SliverPadding(
        padding: const EdgeInsets.all(16),
        sliver: SliverGrid(
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: columns, mainAxisSpacing: 12, crossAxisSpacing: 12, mainAxisExtent: 300),
          delegate: SliverChildBuilderDelegate((_, i) => AuctionCard(auction: items[i], badge: badgeFor?.call(items[i])), childCount: items.length),
        ),
      ),
      if (footer != null) SliverToBoxAdapter(child: footer),
    ]);
  }
}
