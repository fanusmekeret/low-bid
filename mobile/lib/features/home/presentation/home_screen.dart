import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/app_strings.dart';
import '../../../core/theme/app_theme.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/auction_card.dart';
import '../../../shared/widgets/common.dart';
import '../../../shared/widgets/logo.dart';
import '../../auth/application/auth_controller.dart';
import '../../catalog/data/catalog_repository.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    final home = ref.watch(homeProvider);
    final user = ref.watch(currentUserProvider);

    return Scaffold(
      appBar: AppBar(
        title: const LowBidLogo(size: 30),
        actions: [
          if (user != null) IconButton(tooltip: s.notifications, icon: const Icon(Icons.notifications_outlined), onPressed: () => context.push('/notifications')),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(homeProvider.future),
        child: CustomScrollView(slivers: [
          SliverToBoxAdapter(child: _SearchBar(onTap: () => context.go('/search'))),
          ...home.when(
            skipLoadingOnRefresh: true,
            loading: () => [const SliverFillRemaining(child: Center(child: CircularProgressIndicator()))],
            error: (e, _) => [SliverFillRemaining(child: ErrorState(message: s.error(e), onRetry: () => ref.invalidate(homeProvider)))],
            data: (data) => _sections(context, data),
          ),
          const SliverToBoxAdapter(child: SizedBox(height: 24)),
        ]),
      ),
    );
  }

  List<Widget> _sections(BuildContext context, HomeData d) {
    final s = S.of(context);
    final lang = Localizations.localeOf(context).languageCode;
    if (d.isEmpty) {
      return [SliverFillRemaining(child: EmptyState(icon: Icons.gavel_outlined, title: s.noAuctionsYet))];
    }
    Widget rail(String title, List<AuctionCardModel> items, String query, {Widget? leading}) => SliverToBoxAdapter(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SectionHeader(title: title, leading: leading, onSeeAll: () => context.go('/search?$query')),
            AuctionRail(items: items),
          ]),
        );

    return [
      if (d.banners.isNotEmpty) SliverToBoxAdapter(child: _Banners(banners: d.banners, lang: lang)),
      if (d.endingSoon.isNotEmpty)
        rail(s.endingSoon, d.endingSoon, 'status=live', leading: const Icon(Icons.timer_outlined, color: AppColors.red)),
      if (d.featured.isNotEmpty) rail(s.featured, d.featured, 'status=open'),
      if (d.live.isNotEmpty) rail(s.liveNow, d.live, 'status=live', leading: const _LiveDot()),
      if (d.popularCategories.isNotEmpty)
        SliverToBoxAdapter(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SectionHeader(title: s.popularCategories),
            SizedBox(
              height: 44,
              child: ListView.separated(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                scrollDirection: Axis.horizontal,
                itemCount: d.popularCategories.length,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (_, i) {
                  final c = d.popularCategories[i];
                  return ActionChip(
                    avatar: Icon(categoryIcon(c.iconKey), size: 18),
                    label: Text('${c.name(lang)} · ${c.openAuctions ?? 0}'),
                    onPressed: () => context.go('/search?category=${c.slug}'),
                  );
                },
              ),
            ),
          ]),
        ),
      if (d.upcoming.isNotEmpty) rail(s.upcoming, d.upcoming, 'status=upcoming'),
      if (d.recentlyAdded.isNotEmpty) rail(s.recentlyAdded, d.recentlyAdded, 'status=open'),
    ];
  }
}

IconData categoryIcon(String? key) {
  switch (key) {
    case 'smartphone':
      return Icons.smartphone;
    case 'devices':
      return Icons.devices_other;
    case 'car':
      return Icons.directions_car_outlined;
    case 'sofa':
      return Icons.weekend_outlined;
    case 'home':
      return Icons.home_work_outlined;
    case 'kitchen':
      return Icons.kitchen_outlined;
    case 'checkroom':
      return Icons.checkroom_outlined;
    case 'factory':
      return Icons.precision_manufacturing_outlined;
    case 'agriculture':
      return Icons.agriculture_outlined;
    default:
      return Icons.category_outlined;
  }
}

class _SearchBar extends StatelessWidget {
  const _SearchBar({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: Material(
        color: Theme.of(context).inputDecorationTheme.fillColor,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: BorderSide(color: Theme.of(context).colorScheme.outlineVariant)),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            child: Row(children: [
              Icon(Icons.search, color: Theme.of(context).colorScheme.onSurfaceVariant),
              const SizedBox(width: 12),
              Expanded(child: Text(S.of(context).searchHint, style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant))),
            ]),
          ),
        ),
      ),
    );
  }
}

class _Banners extends StatelessWidget {
  const _Banners({required this.banners, required this.lang});
  final List<BannerModel> banners;
  final String lang;

  void _open(BuildContext context, BannerModel b) {
    if (b.linkType == 'AUCTION' && b.linkValue != null) context.push('/auctions/${b.linkValue}');
    if (b.linkType == 'CATEGORY' && b.linkValue != null) context.go('/search?category=${b.linkValue}');
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: SizedBox(
        height: 160,
        child: PageView.builder(
          controller: PageController(viewportFraction: 0.9),
          itemCount: banners.length,
          itemBuilder: (_, i) => Padding(
            padding: const EdgeInsets.symmetric(horizontal: 6),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: InkWell(
                onTap: () => _open(context, banners[i]),
                child: Stack(fit: StackFit.expand, children: [
                  AppNetworkImage(url: banners[i].imageUrl),
                  Align(
                    alignment: Alignment.bottomLeft,
                    child: Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(14),
                      color: Colors.black.withValues(alpha: 0.35),
                      child: Text(banners[i].title(lang), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 16)),
                    ),
                  ),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _LiveDot extends StatefulWidget {
  const _LiveDot();
  @override
  State<_LiveDot> createState() => _LiveDotState();
}

class _LiveDotState extends State<_LiveDot> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: Tween(begin: 0.35, end: 1.0).animate(_c),
      child: Container(width: 10, height: 10, decoration: const BoxDecoration(color: AppColors.amber, shape: BoxShape.circle)),
    );
  }
}
