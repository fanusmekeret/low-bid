import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/format/formatters.dart';
import '../../../core/l10n/app_strings.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/common.dart';
import '../data/seller_repository.dart';

class SellerAuctionsScreen extends ConsumerWidget {
  const SellerAuctionsScreen({super.key});

  static const _filters = <String?>[null, 'PENDING_APPROVAL', 'SCHEDULED', 'LIVE', 'CLOSED'];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    return DefaultTabController(
      length: _filters.length,
      child: Scaffold(
        appBar: AppBar(
          title: Text(s.myAuctions),
          bottom: TabBar(isScrollable: true, tabAlignment: TabAlignment.start, tabs: [
            for (final f in _filters) Tab(text: f == null ? s.all : s.auctionStatus(f)),
          ]),
        ),
        body: TabBarView(children: [for (final f in _filters) _List(status: f)]),
      ),
    );
  }
}

class _List extends ConsumerWidget {
  const _List({required this.status});
  final String? status;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    return RefreshIndicator(
      onRefresh: () => ref.refresh(sellerAuctionsProvider(status).future),
      child: AsyncValueView<Paged<ManagedAuction>>(
        value: ref.watch(sellerAuctionsProvider(status)),
        onRetry: () => ref.invalidate(sellerAuctionsProvider(status)),
        data: (page) => page.items.isEmpty
            ? ListView(children: [SizedBox(height: 400, child: EmptyState(icon: Icons.gavel_outlined, title: s.nothingHere))])
            : ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                itemCount: page.items.length,
                separatorBuilder: (_, __) => const SizedBox(height: 12),
                itemBuilder: (_, i) => _AuctionTile(a: page.items[i]),
              ),
      ),
    );
  }
}

class _AuctionTile extends ConsumerWidget {
  const _AuctionTile({required this.a});
  final ManagedAuction a;

  bool get _cancellable => a.status == 'PENDING_APPROVAL' || a.status == 'SCHEDULED' || (a.status == 'LIVE' && a.bidCount == 0);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    final lang = s.lang;
    final theme = Theme.of(context);
    final shown = a.status == 'SCHEDULED' || a.status == 'LIVE' || a.status == 'CLOSED';
    return Card(
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: shown ? () => context.push('/auctions/${a.id}') : null,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            ClipRRect(borderRadius: BorderRadius.circular(8), child: SizedBox(width: 64, height: 64, child: AppNetworkImage(url: a.coverImage?.sm, iconSize: 22))),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(a.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
                const SizedBox(height: 4),
                Wrap(spacing: 6, runSpacing: 4, children: [
                  StatusPill(s.auctionStatus(a.status), color: statusColor(a.status)),
                  if (a.resultStatus != null) StatusPill(s.resultStatus(a.resultStatus!), color: statusColor(a.resultStatus!)),
                ]),
                const SizedBox(height: 6),
                Text('${s.yourPrice}: ${a.sellerPrice.format(languageCode: lang)}', style: const TextStyle(fontWeight: FontWeight.w700)),
                Text('${s.bids(a.bidCount)} · ${s.feesCollected}: ${a.feesCollected.format(languageCode: lang)}', style: theme.textTheme.bodySmall),
                if (a.finalPrice != null) Text('${s.winningBid}: ${a.finalPrice!.format(languageCode: lang, showCents: true)}', style: theme.textTheme.bodySmall),
                Text('${formatDateTime(a.startsAt, lang)} → ${formatDateTime(a.endsAt, lang)}', style: theme.textTheme.bodySmall),
                if (a.cancelledReason != null) Text(a.cancelledReason!, style: theme.textTheme.bodySmall),
              ]),
            ),
            if (_cancellable)
              PopupMenuButton<String>(
                onSelected: (_) => _cancel(context, ref),
                itemBuilder: (_) => [PopupMenuItem(value: 'cancel', child: Text(s.cancel))],
              ),
          ]),
        ),
      ),
    );
  }

  Future<void> _cancel(BuildContext context, WidgetRef ref) async {
    final s = S.of(context);
    final controller = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(s.cancel),
        content: TextField(controller: controller, maxLength: 500, decoration: InputDecoration(hintText: s.refundReason)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c), child: Text(s.close)),
          FilledButton(onPressed: () => Navigator.pop(c, controller.text.trim()), child: Text(s.submit)),
        ],
      ),
    );
    controller.dispose();
    if (reason == null || reason.length < 3) return;
    try {
      await ref.read(sellerRepositoryProvider).cancelAuction(a.id, reason);
      ref.invalidate(sellerAuctionsProvider);
    } catch (e) {
      if (context.mounted) showSnack(context, s.error(e), error: true);
    }
  }
}
