import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/app_strings.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/common.dart';
import '../data/seller_repository.dart';

class ListingsScreen extends ConsumerWidget {
  const ListingsScreen({super.key});

  static const _filters = <String?>[null, 'DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    return DefaultTabController(
      length: _filters.length,
      child: Scaffold(
        appBar: AppBar(
          title: Text(s.myListings),
          bottom: TabBar(isScrollable: true, tabAlignment: TabAlignment.start, tabs: [
            for (final f in _filters) Tab(text: f == null ? s.all : s.listingStatus(f)),
          ]),
        ),
        floatingActionButton: FloatingActionButton.extended(onPressed: () => context.push('/seller/listings/new'), icon: const Icon(Icons.add), label: Text(s.newListing)),
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
      onRefresh: () => ref.refresh(sellerProductsProvider(status).future),
      child: AsyncValueView<Paged<ProductModel>>(
        value: ref.watch(sellerProductsProvider(status)),
        onRetry: () => ref.invalidate(sellerProductsProvider(status)),
        data: (page) => page.items.isEmpty
            ? ListView(children: [SizedBox(height: 400, child: EmptyState(icon: Icons.inventory_2_outlined, title: s.nothingHere))])
            : ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(0, 8, 0, 96),
                itemCount: page.items.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (_, i) {
                  final p = page.items[i];
                  return ListTile(
                    leading: ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: SizedBox(width: 56, height: 56, child: AppNetworkImage(url: p.images.isEmpty ? null : p.images.first.urls.sm, iconSize: 22)),
                    ),
                    title: Text(p.title, maxLines: 2, overflow: TextOverflow.ellipsis),
                    subtitle: Text([if (p.categoryName != null) p.categoryName!, s.condition(p.condition)].join(' · ')),
                    trailing: StatusPill(s.listingStatus(p.status), color: statusColor(p.status)),
                    onTap: () async {
                      await context.push('/seller/listings/${p.id}');
                      ref.invalidate(sellerProductsProvider);
                    },
                  );
                },
              ),
      ),
    );
  }
}
