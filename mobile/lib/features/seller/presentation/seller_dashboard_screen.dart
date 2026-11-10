import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/app_strings.dart';
import '../../../core/money/money.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/common.dart';
import '../data/seller_repository.dart';

class SellerDashboardScreen extends ConsumerWidget {
  const SellerDashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(s.sellerDashboard)),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(earningsProvider);
          await ref.refresh(sellerProfileProvider.future);
        },
        child: AsyncValueView<SellerProfileModel?>(
          value: ref.watch(sellerProfileProvider),
          onRetry: () => ref.invalidate(sellerProfileProvider),
          data: (p) => p == null
              ? ListView(children: [
                  SizedBox(
                    height: 420,
                    child: EmptyState(
                      icon: Icons.storefront_outlined,
                      title: s.becomeSeller,
                      body: s.sellerApplyBody,
                      action: FilledButton(onPressed: () => context.pushReplacement('/seller/apply'), child: Text(s.sellerApply)),
                    ),
                  ),
                ])
              : _Dashboard(profile: p),
        ),
      ),
    );
  }
}

class _Dashboard extends ConsumerWidget {
  const _Dashboard({required this.profile});
  final SellerProfileModel profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    final theme = Theme.of(context);
    final p = profile;
    final approved = p.status == 'APPROVED';

    return ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.all(16), children: [
      Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(p.businessName, style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800))),
              StatusPill(s.sellerStatus(p.status), color: statusColor(p.status)),
            ]),
            const SizedBox(height: 8),
            Text(s.sellerStatusBody(p.status)),
            if (p.missing.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text(s.missingDocuments, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
              for (final m in p.missing)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Row(children: [const Icon(Icons.error_outline, size: 18), const SizedBox(width: 8), Expanded(child: Text(s.missing(m)))]),
                ),
              const SizedBox(height: 8),
              FilledButton.tonalIcon(onPressed: () => context.push('/seller/documents'), icon: const Icon(Icons.upload_file), label: Text(s.uploadDocument)),
            ],
          ]),
        ),
      ),
      if (approved) ...[
        const SizedBox(height: 16),
        const _EarningsCard(),
        const SizedBox(height: 16),
        Row(children: [
          Expanded(child: FilledButton.icon(onPressed: () => context.push('/seller/listings/new'), icon: const Icon(Icons.add), label: Text(s.newListing))),
        ]),
      ],
      const SizedBox(height: 8),
      if (approved) ...[
        ListTile(leading: const Icon(Icons.inventory_2_outlined), title: Text(s.myListings), trailing: const Icon(Icons.chevron_right), onTap: () => context.push('/seller/listings')),
        ListTile(leading: const Icon(Icons.gavel_outlined), title: Text(s.myAuctions), trailing: const Icon(Icons.chevron_right), onTap: () => context.push('/seller/auctions')),
      ],
      ListTile(leading: const Icon(Icons.badge_outlined), title: Text(s.documents), trailing: const Icon(Icons.chevron_right), onTap: () => context.push('/seller/documents')),
    ]);
  }
}

class _EarningsCard extends ConsumerWidget {
  const _EarningsCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    final lang = s.lang;
    final theme = Theme.of(context);
    final async = ref.watch(earningsProvider);
    Widget cell(String k, Money v) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(children: [Expanded(child: Text(k)), Text(v.format(languageCode: lang), style: const TextStyle(fontWeight: FontWeight.w700))]),
        );
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: async.when(
          loading: () => const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator())),
          error: (e, _) => Text(s.error(e)),
          data: (e) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(s.earnings, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 4),
            MoneyText(e.netEarnings, style: theme.textTheme.headlineSmall),
            Text(s.netEarnings, style: theme.textTheme.bodySmall),
            const Divider(height: 24),
            cell(s.grossSales, e.grossSales),
            cell(s.commission, e.commission),
            cell(s.paidOut, e.paidOut),
            cell(s.pendingPayout, e.pending),
            if (e.onHold > Money.zero) cell(s.onHold, e.onHold),
          ]),
        ),
      ),
    );
  }
}
