import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/format/formatters.dart';
import '../../../core/l10n/app_strings.dart';
import '../../../core/theme/app_theme.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/common.dart';
import '../../catalog/data/catalog_repository.dart';

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  final _items = <NotificationModel>[];
  final _read = <String>{};
  final _scroll = ScrollController();
  String? _cursor;
  bool _hasMore = true;
  bool _loading = false;
  int _unread = 0;
  Object? _error;

  CatalogRepository get _repo => ref.read(catalogRepositoryProvider);

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
      final (page, unread) = await _repo.notifications(cursor: reset ? null : _cursor);
      if (!mounted) return;
      setState(() {
        if (reset) {
          _items.clear();
          _read.clear();
        }
        _items.addAll(page.items);
        _cursor = page.nextCursor;
        _hasMore = page.nextCursor != null;
        _unread = unread;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  bool _isRead(NotificationModel n) => n.read || _read.contains(n.id);

  Future<void> _open(NotificationModel n) async {
    if (!_isRead(n)) {
      setState(() {
        _read.add(n.id);
        _unread = (_unread - 1).clamp(0, 1 << 30);
      });
      _repo.markRead(n.id).ignore();
    }
    if (n.txRef != null) {
      context.push('/payments/${n.txRef}');
    } else if (n.auctionId != null) {
      context.push('/auctions/${n.auctionId}');
    }
  }

  Future<void> _markAll() async {
    final s = S.of(context);
    try {
      await _repo.markAllRead();
      setState(() {
        _read.addAll(_items.map((n) => n.id));
        _unread = 0;
      });
    } catch (e) {
      if (mounted) showSnack(context, s.error(e), error: true);
    }
  }

  IconData _icon(String type) {
    if (type.contains('BID_CONFIRMED')) return Icons.gavel;
    if (type.contains('WON')) return Icons.emoji_events_outlined;
    if (type.contains('PAYMENT') || type.contains('REFUND') || type.contains('PAYOUT')) return Icons.payments_outlined;
    if (type.contains('ENDING')) return Icons.timer_outlined;
    if (type.contains('SELLER') || type.contains('PRODUCT') || type.contains('LISTING')) return Icons.storefront_outlined;
    return Icons.notifications_outlined;
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final lang = s.lang;
    Widget body;
    if (_items.isEmpty && _error != null) {
      body = ErrorState(message: s.error(_error!), onRetry: () => _load(reset: true));
    } else if (_items.isEmpty && _loading) {
      body = const Center(child: CircularProgressIndicator());
    } else if (_items.isEmpty) {
      body = EmptyState(icon: Icons.notifications_none, title: s.noNotifications);
    } else {
      body = RefreshIndicator(
        onRefresh: () => _load(reset: true),
        child: ListView.separated(
          controller: _scroll,
          physics: const AlwaysScrollableScrollPhysics(),
          itemCount: _items.length + (_hasMore ? 1 : 0),
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (_, i) {
            if (i == _items.length) return const Padding(padding: EdgeInsets.all(20), child: Center(child: CircularProgressIndicator()));
            final n = _items[i];
            final unread = !_isRead(n);
            return ListTile(
              tileColor: unread ? AppColors.amber.withValues(alpha: 0.08) : null,
              leading: CircleAvatar(child: Icon(_icon(n.type), size: 20)),
              title: Text(n.title, style: TextStyle(fontWeight: unread ? FontWeight.w800 : FontWeight.w500)),
              subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(n.body),
                const SizedBox(height: 2),
                Text(formatRelative(n.createdAt, lang), style: Theme.of(context).textTheme.bodySmall),
              ]),
              isThreeLine: true,
              onTap: () => _open(n),
            );
          },
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(
        title: Text(s.notifications),
        actions: [if (_unread > 0) TextButton(onPressed: _markAll, child: Text(s.markAllRead))],
      ),
      body: body,
    );
  }
}
