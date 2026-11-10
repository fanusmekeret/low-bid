import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/format/formatters.dart';
import '../../../core/l10n/app_strings.dart';
import '../../../core/theme/app_theme.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/common.dart';
import '../../catalog/data/catalog_repository.dart';
import '../../payments/data/payments_repository.dart';

/// Auctions I won: pay, see the receipt, confirm delivery or ask for a refund.
class WonScreen extends ConsumerWidget {
  const WonScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(s.wonAuctions)),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(wonProvider.future),
        child: AsyncValueView<Paged<WonItem>>(
          value: ref.watch(wonProvider),
          onRetry: () => ref.invalidate(wonProvider),
          data: (page) => page.items.isEmpty
              ? ListView(children: [SizedBox(height: 400, child: EmptyState(icon: Icons.emoji_events_outlined, title: s.nothingHere))])
              : ListView.separated(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.all(16),
                  itemCount: page.items.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (_, i) => _WonCard(item: page.items[i]),
                ),
        ),
      ),
    );
  }
}

class _WonCard extends ConsumerWidget {
  const _WonCard({required this.item});
  final WonItem item;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    final lang = s.lang;
    final theme = Theme.of(context);
    final a = item.card;

    return Card(
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        InkWell(
          onTap: () => context.push('/auctions/${a.id}'),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              ClipRRect(borderRadius: BorderRadius.circular(10), child: SizedBox(width: 72, height: 72, child: AppNetworkImage(url: a.coverImage?.sm, iconSize: 24))),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(a.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 6),
                  StatusPill(s.resultStatus(item.status), color: statusColor(item.status)),
                ]),
              ),
            ]),
          ),
        ),
        const Divider(height: 1),
        Padding(
          padding: const EdgeInsets.all(12),
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(item.status == 'AWAITING_PAYMENT' ? s.amountDue : s.totalPaid, style: theme.textTheme.bodySmall),
                MoneyText(item.totalDue, style: theme.textTheme.titleMedium),
                if (item.status == 'AWAITING_PAYMENT' && item.paymentDeadline != null)
                  Text(s.payBy(formatDateTime(item.paymentDeadline!, lang)), style: theme.textTheme.bodySmall?.copyWith(color: AppColors.red)),
              ]),
            ),
            ..._actions(context, ref, s),
          ]),
        ),
      ]),
    );
  }

  List<Widget> _actions(BuildContext context, WidgetRef ref, S s) {
    switch (item.status) {
      case 'AWAITING_PAYMENT':
        return [
          FilledButton.icon(
            onPressed: () => runCheckout(context, ref, (repo) => repo.startCheckout(item.card.id)),
            icon: const Icon(Icons.payments_outlined),
            label: Text(s.payNow),
          ),
        ];
      case 'PAID':
        return [
          if (item.txRef != null) IconButton(tooltip: s.viewReceipt, onPressed: () => context.push('/payments/${item.txRef}/receipt'), icon: const Icon(Icons.receipt_long_outlined)),
          PopupMenuButton<String>(
            onSelected: (v) => v == 'received' ? _confirmReceived(context, ref) : _requestRefund(context, ref),
            itemBuilder: (_) => [
              PopupMenuItem(value: 'received', child: Text(s.confirmReceived)),
              if (item.txRef != null) PopupMenuItem(value: 'refund', child: Text(s.requestRefund)),
            ],
          ),
        ];
      case 'FULFILLED':
      case 'DISPUTED':
        return [
          if (item.txRef != null) IconButton(tooltip: s.viewReceipt, onPressed: () => context.push('/payments/${item.txRef}/receipt'), icon: const Icon(Icons.receipt_long_outlined)),
        ];
      default:
        return const [];
    }
  }

  Future<void> _confirmReceived(BuildContext context, WidgetRef ref) async {
    final s = S.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(s.confirmReceived),
        content: Text(s.confirmReceivedBody),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(s.cancel)),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(s.received)),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(catalogRepositoryProvider).confirmReceived(item.card.id);
      ref.invalidate(wonProvider);
    } catch (e) {
      if (context.mounted) showSnack(context, s.error(e), error: true);
    }
  }

  Future<void> _requestRefund(BuildContext context, WidgetRef ref) async {
    final s = S.of(context);
    final reason = await showDialog<String>(context: context, builder: (_) => const _RefundDialog());
    if (reason == null || item.txRef == null) return;
    try {
      await ref.read(paymentsRepositoryProvider).requestRefund(item.txRef!, reason);
      ref.invalidate(wonProvider);
      if (context.mounted) showSnack(context, s.refundRequested);
    } catch (e) {
      if (context.mounted) showSnack(context, s.error(e), error: true);
    }
  }
}

class _RefundDialog extends StatefulWidget {
  const _RefundDialog();
  @override
  State<_RefundDialog> createState() => _RefundDialogState();
}

class _RefundDialogState extends State<_RefundDialog> {
  final _c = TextEditingController();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    return AlertDialog(
      title: Text(s.requestRefund),
      content: TextField(controller: _c, maxLines: 4, maxLength: 500, decoration: InputDecoration(hintText: s.refundReason), onChanged: (_) => setState(() {})),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(s.cancel)),
        FilledButton(onPressed: _c.text.trim().length < 3 ? null : () => Navigator.pop(context, _c.text.trim()), child: Text(s.submit)),
      ],
    );
  }
}
