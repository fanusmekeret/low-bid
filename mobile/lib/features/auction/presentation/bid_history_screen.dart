import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/app_strings.dart';
import '../../../core/theme/app_theme.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/common.dart';
import '../../catalog/data/catalog_repository.dart';

/// The revealed result of a closed auction: every paid bid in ranking order. Unique amounts
/// come first (lowest first), then the shared amounts. The winning bid is highlighted.
class BidHistoryScreen extends ConsumerStatefulWidget {
  const BidHistoryScreen({super.key, required this.auctionId});
  final String auctionId;

  @override
  ConsumerState<BidHistoryScreen> createState() => _BidHistoryScreenState();
}

class _BidHistoryScreenState extends ConsumerState<BidHistoryScreen> {
  final _bids = <BidEntry>[];
  final _scroll = ScrollController();
  String? _cursor;
  bool _hasMore = true;
  bool _loading = false;
  int? _total;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 400) _load();
    });
    _load();
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load({bool reset = false}) async {
    if (_loading || (!_hasMore && !reset)) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await ref.read(catalogRepositoryProvider).results(widget.auctionId, cursor: reset ? null : _cursor);
      if (!mounted) return;
      setState(() {
        if (reset) _bids.clear();
        _bids.addAll(page.items);
        _cursor = page.nextCursor;
        _hasMore = page.nextCursor != null;
        _total = page.total;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    Widget body;
    if (_bids.isEmpty && _error != null) {
      // BIDS_SECRET while the auction is still open.
      body = ErrorState(message: s.error(_error!), onRetry: () => _load(reset: true));
    } else if (_bids.isEmpty && _loading) {
      body = const Center(child: CircularProgressIndicator());
    } else if (_bids.isEmpty) {
      body = EmptyState(icon: Icons.gavel_outlined, title: s.noBidsYet);
    } else {
      body = RefreshIndicator(
        onRefresh: () => _load(reset: true),
        child: ListView.separated(
          controller: _scroll,
          physics: const AlwaysScrollableScrollPhysics(),
          itemCount: _bids.length + 1 + (_hasMore ? 1 : 0),
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (_, i) {
            if (i == 0) {
              return Padding(
                padding: const EdgeInsets.all(16),
                child: Text(s.bids(_total ?? _bids.length), style: Theme.of(context).textTheme.titleSmall),
              );
            }
            final index = i - 1;
            if (index == _bids.length) return const Padding(padding: EdgeInsets.all(20), child: Center(child: CircularProgressIndicator()));
            return ResultTile(bid: _bids[index]);
          },
        ),
      );
    }
    return Scaffold(appBar: AppBar(title: Text(s.results)), body: body);
  }
}

/// One row of the revealed ranking. Bidders are shown by alias only.
class ResultTile extends StatelessWidget {
  const ResultTile({super.key, required this.bid});
  final BidEntry bid;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final theme = Theme.of(context);
    final b = bid;
    return ListTile(
      tileColor: b.isWinning ? AppColors.green.withValues(alpha: 0.12) : null,
      leading: CircleAvatar(
        radius: 18,
        backgroundColor: b.isWinning ? AppColors.green : (b.isYou ? AppColors.amber : theme.colorScheme.surfaceContainerHighest),
        child: b.isWinning
            ? const Icon(Icons.emoji_events, size: 18, color: Colors.white)
            : Text('${b.rank}', style: TextStyle(fontWeight: FontWeight.w700, color: b.isYou ? Colors.black : null)),
      ),
      title: Text(b.isYou ? '${b.bidderAlias} (${s.you})' : b.bidderAlias, style: TextStyle(fontWeight: b.isYou ? FontWeight.w800 : FontWeight.w500)),
      subtitle: Text(b.isWinning ? s.winningBid : (b.unique ? s.uniqueBid : s.sharedBid)),
      trailing: Text(
        b.amount.format(languageCode: s.lang, showCents: true),
        style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800, fontFeatures: tabularFigures, color: b.unique ? null : theme.colorScheme.onSurfaceVariant),
      ),
    );
  }
}
