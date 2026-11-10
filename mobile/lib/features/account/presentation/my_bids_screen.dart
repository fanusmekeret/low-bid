import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/app_strings.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/auction_card.dart';
import '../../../shared/widgets/common.dart';
import '../../auth/application/auth_controller.dart';
import '../../catalog/data/catalog_repository.dart';

/// Auctions I have bid on: active (leading / outbid) and ended (won / lost).
class MyBidsScreen extends ConsumerWidget {
  const MyBidsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    final user = ref.watch(currentUserProvider);
    if (user == null) {
      return Scaffold(
        appBar: AppBar(title: Text(s.myBids)),
        body: EmptyState(
          icon: Icons.gavel_outlined,
          title: s.guestTitle,
          body: s.guestBody,
          action: FilledButton(onPressed: () => context.push('/login?from=/my-bids'), child: Text(s.login)),
        ),
      );
    }
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: Text(s.myBids),
          actions: [IconButton(tooltip: s.wonAuctions, icon: const Icon(Icons.emoji_events_outlined), onPressed: () => context.push('/won'))],
          bottom: TabBar(tabs: [Tab(text: s.active), Tab(text: s.ended)]),
        ),
        body: const TabBarView(children: [_BidList(status: 'active'), _BidList(status: 'ended')]),
      ),
    );
  }
}

class _BidList extends ConsumerWidget {
  const _BidList({required this.status});
  final String status;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    final async = ref.watch(myBidsProvider(status));
    return RefreshIndicator(
      onRefresh: () => ref.refresh(myBidsProvider(status).future),
      child: AsyncValueView<Paged<AuctionCardModel>>(
        value: async,
        onRetry: () => ref.invalidate(myBidsProvider(status)),
        data: (page) => page.items.isEmpty
            ? ListView(children: [SizedBox(height: 400, child: EmptyState(icon: Icons.gavel_outlined, title: s.noBidsMade))])
            : AuctionGrid(
                items: page.items,
                badgeFor: (a) => a.myStatus == null ? null : StatusPill(s.myStatus(a.myStatus!), color: statusColor(a.myStatus!)),
              ),
      ),
    );
  }
}
