import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/app_strings.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/auction_card.dart';
import '../../../shared/widgets/common.dart';
import '../../catalog/data/catalog_repository.dart';

class WatchlistScreen extends ConsumerWidget {
  const WatchlistScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(s.watchlist)),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(watchlistProvider.future),
        child: AsyncValueView<Paged<AuctionCardModel>>(
          value: ref.watch(watchlistProvider),
          onRetry: () => ref.invalidate(watchlistProvider),
          data: (page) => page.items.isEmpty
              ? ListView(children: [SizedBox(height: 400, child: EmptyState(icon: Icons.bookmark_border, title: s.noWatchlist))])
              : AuctionGrid(items: page.items),
        ),
      ),
    );
  }
}
