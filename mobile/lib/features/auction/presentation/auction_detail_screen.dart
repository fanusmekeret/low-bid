import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/format/formatters.dart';
import '../../../core/l10n/app_strings.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/time/server_clock.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/common.dart';
import '../../../shared/widgets/countdown/auction_countdown.dart';
import '../../auth/application/auth_controller.dart';
import '../../auth/presentation/login_screen.dart';
import '../../auth/presentation/otp_screen.dart';
import '../../payments/data/payments_repository.dart';
import '../application/auction_detail_controller.dart';
import 'bid_sheet.dart';

class AuctionDetailScreen extends ConsumerWidget {
  const AuctionDetailScreen({super.key, required this.auctionId});

  final String auctionId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    final async = ref.watch(auctionDetailProvider(auctionId));
    final view = async.valueOrNull;

    return Scaffold(
      appBar: AppBar(
        title: Text(view?.detail.card.title ?? '', maxLines: 1, overflow: TextOverflow.ellipsis),
        actions: [if (view != null && view.detail.viewer != null) _WatchButton(auctionId: auctionId, watching: view.detail.viewer!.isWatching)],
      ),
      body: view == null
          ? (async.hasError
              ? ErrorState(message: s.error(async.error!), onRetry: () => ref.invalidate(auctionDetailProvider(auctionId)))
              : const Center(child: CircularProgressIndicator()))
          : _Body(view: view),
      bottomNavigationBar: view == null ? null : _BottomBar(view: view),
    );
  }
}

class _WatchButton extends ConsumerWidget {
  const _WatchButton({required this.auctionId, required this.watching});
  final String auctionId;
  final bool watching;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    return IconButton(
      tooltip: watching ? s.watching : s.watch,
      icon: Icon(watching ? Icons.bookmark : Icons.bookmark_border),
      onPressed: () async {
        try {
          await ref.read(auctionDetailProvider(auctionId).notifier).toggleWatch();
        } catch (e) {
          if (context.mounted) showSnack(context, s.error(e), error: true);
        }
      },
    );
  }
}

class _Body extends ConsumerWidget {
  const _Body({required this.view});
  final AuctionView view;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final d = view.detail;
    final s = S.of(context);
    final controller = ref.read(auctionDetailProvider(d.id).notifier);

    return Column(children: [
      // The countdown sits outside the scroll view so it is always visible.
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
        child: AuctionCountdown(
          startsAt: d.card.startsAt,
          endsAt: d.card.endsAt,
          closed: d.card.isClosed,
          size: CountdownSize.banner,
          // The server may wait a few minutes for late bid fees before announcing the result.
          onEnded: () => Future<void>.delayed(const Duration(seconds: 3), controller.refresh),
        ),
      ),
      Expanded(
        child: RefreshIndicator(
          onRefresh: controller.refresh,
          child: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
            _Gallery(images: d.images),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(d.card.title, style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
                const SizedBox(height: 8),
                Wrap(spacing: 8, runSpacing: 8, children: [
                  StatusPill(s.condition(d.card.condition), color: AppColors.teal),
                  if (d.card.location.isNotEmpty) StatusPill(d.card.location, color: AppColors.teal, icon: Icons.place_outlined),
                  for (final h in d.card.highlights) StatusPill(h, color: AppColors.teal),
                ]),
              ]),
            ),
            if (d.card.isClosed) _ResultPanel(detail: d),
            _BiddingPanel(detail: d),
            if (view.myBids.isNotEmpty && !d.card.isClosed) _MyBidsPanel(view: view),
            if (d.specs.isNotEmpty) _Specs(groups: d.specs),
            if (d.description.isNotEmpty)
              _Section(title: s.description, child: Text(d.description, style: Theme.of(context).textTheme.bodyMedium?.copyWith(height: 1.5))),
            if (d.seller != null) _SellerTile(seller: d.seller!),
          ]),
        ),
      ),
    ]);
  }
}

class _Gallery extends StatefulWidget {
  const _Gallery({required this.images});
  final List<ImageUrls> images;

  @override
  State<_Gallery> createState() => _GalleryState();
}

class _GalleryState extends State<_Gallery> {
  int _index = 0;

  void _openFull(BuildContext context, int start) {
    Navigator.of(context, rootNavigator: true).push(MaterialPageRoute<void>(
      fullscreenDialog: true,
      builder: (_) => Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white),
        body: PageView.builder(
          controller: PageController(initialPage: start),
          itemCount: widget.images.length,
          itemBuilder: (_, i) => InteractiveViewer(child: Center(child: AppNetworkImage(url: widget.images[i].lg, fit: BoxFit.contain))),
        ),
      ),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final images = widget.images;
    if (images.isEmpty) {
      return AspectRatio(aspectRatio: 4 / 3, child: Container(color: Theme.of(context).colorScheme.surfaceContainerHighest, child: const Icon(Icons.image_outlined, size: 48)));
    }
    return AspectRatio(
      aspectRatio: 4 / 3,
      child: Stack(children: [
        PageView.builder(
          itemCount: images.length,
          onPageChanged: (i) => setState(() => _index = i),
          itemBuilder: (_, i) => GestureDetector(onTap: () => _openFull(context, i), child: AppNetworkImage(url: images[i].md)),
        ),
        if (images.length > 1)
          Positioned(
            right: 12,
            bottom: 12,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(999)),
              child: Text('${_index + 1} / ${images.length}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
            ),
          ),
      ]),
    );
  }
}

/// Item value, bid fee, allowed range, paid-bid count and how the auction works.
class _BiddingPanel extends StatelessWidget {
  const _BiddingPanel({required this.detail});
  final AuctionDetailModel detail;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final lang = s.lang;
    final d = detail;
    final b = d.bidding;
    final theme = Theme.of(context);

    return Card(
      margin: const EdgeInsets.fromLTRB(16, 16, 16, 0),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(s.bidFee, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                const SizedBox(height: 2),
                MoneyText(b.bidFee, style: theme.textTheme.headlineSmall),
              ]),
            ),
            Row(children: [
              const Icon(Icons.gavel, size: 18),
              const SizedBox(width: 4),
              Text(s.bids(d.card.bidCount), style: theme.textTheme.labelLarge),
            ]),
          ]),
          const Divider(height: 24),
          Row(children: [
            if (d.marketValue != null) Expanded(child: _kv(context, s.itemValue, d.marketValue!.format(languageCode: lang))),
            Expanded(child: _kv(context, s.allowedBids, '${b.minBid.format(languageCode: lang, showCents: true)} – ${b.maxBid.format(languageCode: lang)}')),
          ]),
          const SizedBox(height: 8),
          Theme(
            data: theme.copyWith(dividerColor: Colors.transparent),
            child: ExpansionTile(
              tilePadding: EdgeInsets.zero,
              childrenPadding: const EdgeInsets.only(bottom: 8),
              leading: const Icon(Icons.info_outline),
              title: Text(s.howItWorks, style: const TextStyle(fontWeight: FontWeight.w700)),
              children: [
                Text(s.howItWorksBody, style: theme.textTheme.bodyMedium?.copyWith(height: 1.45)),
                const SizedBox(height: 8),
                Text(s.bidSecretNote, style: theme.textTheme.bodySmall),
                if (b.minPaidBids > 0) ...[const SizedBox(height: 8), Text(s.notEnoughBids, style: theme.textTheme.bodySmall)],
              ],
            ),
          ),
        ]),
      ),
    );
  }

  Widget _kv(BuildContext context, String k, String v) {
    final theme = Theme.of(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(k, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
      const SizedBox(height: 2),
      Text(v, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700, fontFeatures: tabularFigures)),
    ]);
  }
}

/// Shown once the auction has closed: the winning bid and a link to every revealed bid.
class _ResultPanel extends StatelessWidget {
  const _ResultPanel({required this.detail});
  final AuctionDetailModel detail;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final theme = Theme.of(context);
    final r = detail.result;
    final myStatus = detail.viewer?.myStatus;

    String headline;
    if (detail.card.status == 'CANCELLED') {
      headline = s.auctionCancelled;
    } else if (r == null) {
      headline = s.auctionEnded;
    } else if (r.outcome == 'SOLD') {
      headline = myStatus == 'WON' ? s.youWon : s.winningBid;
    } else if (r.outcome == 'NOT_ENOUGH_BIDS') {
      headline = s.notEnoughBids;
    } else {
      headline = s.noSale;
    }

    return Card(
      margin: const EdgeInsets.fromLTRB(16, 16, 16, 0),
      color: myStatus == 'WON' ? AppColors.green.withValues(alpha: 0.12) : null,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(headline, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
          if (r?.finalPrice != null) ...[
            const SizedBox(height: 6),
            MoneyText(r!.finalPrice!, style: theme.textTheme.headlineSmall),
          ],
          if (r?.winnerAlias != null) Text(s.wonBy(r!.winnerAlias!)),
          if (r != null && r.paidBids > 0) ...[
            const SizedBox(height: 6),
            Text(s.resultsSummary(r.paidBids, r.uniqueBids), style: theme.textTheme.bodySmall),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: () => context.push('/auctions/${detail.id}/bids'),
              icon: const Icon(Icons.leaderboard_outlined),
              label: Text(s.seeResults),
            ),
          ],
          if (myStatus != null && myStatus != 'WON') ...[
            const SizedBox(height: 8),
            StatusPill(s.myStatus(myStatus), color: statusColor(myStatus)),
          ],
          if (r == null) Text(s.bidsRevealedAtEnd, style: theme.textTheme.bodySmall),
        ]),
      ),
    );
  }
}

/// The viewer's own bids. Only they see these amounts while bidding is open.
class _MyBidsPanel extends ConsumerWidget {
  const _MyBidsPanel({required this.view});
  final AuctionView view;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    final lang = s.lang;
    final theme = Theme.of(context);
    return _Section(
      title: s.yourBids,
      child: Card(
        margin: EdgeInsets.zero,
        child: Column(children: [
          for (final b in view.myBids)
            ListTile(
              dense: true,
              leading: Icon(b.isPaid ? Icons.check_circle : Icons.hourglass_top, color: b.isPaid ? AppColors.green : const Color(0xFFB36B00)),
              title: Text(b.amount.format(languageCode: lang, showCents: true), style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800, fontFeatures: tabularFigures)),
              subtitle: Text(b.isPaid ? formatRelative(b.createdAt, lang) : s.feeNotPaid),
              trailing: !b.isPaid && b.txRef != null
                  ? TextButton(
                      onPressed: () => openCheckoutUrl(context, url: b.checkoutUrl, txRef: b.txRef!),
                      child: Text(s.payFee),
                    )
                  : null,
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: Row(children: [
              const Icon(Icons.lock_outline, size: 16),
              const SizedBox(width: 6),
              Expanded(child: Text(s.bidSecretNote, style: theme.textTheme.bodySmall)),
            ]),
          ),
        ]),
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child});
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 24, 16, 0),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
        const SizedBox(height: 10),
        child,
      ]),
    );
  }
}

/// The full spec sheet, grouped (Display, Camera, Battery…). Groups after the first two start collapsed.
class _Specs extends StatelessWidget {
  const _Specs({required this.groups});
  final List<SpecGroup> groups;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return _Section(
      title: S.of(context).specifications,
      child: Card(
        margin: EdgeInsets.zero,
        clipBehavior: Clip.antiAlias,
        child: Column(children: [
          for (var i = 0; i < groups.length; i++)
            Theme(
              data: theme.copyWith(dividerColor: Colors.transparent),
              child: ExpansionTile(
                initiallyExpanded: i < 2,
                title: Text(groups[i].group, style: const TextStyle(fontWeight: FontWeight.w700)),
                childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                children: [
                  for (final row in groups[i].rows)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        SizedBox(width: 130, child: Text(row.label, style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant))),
                        const SizedBox(width: 12),
                        Expanded(child: Text(row.value, style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600))),
                      ]),
                    ),
                ],
              ),
            ),
        ]),
      ),
    );
  }
}

class _SellerTile extends StatelessWidget {
  const _SellerTile({required this.seller});
  final SellerSummary seller;

  @override
  Widget build(BuildContext context) {
    return _Section(
      title: S.of(context).soldBy,
      child: Card(
        margin: EdgeInsets.zero,
        child: ListTile(
          leading: CircleAvatar(child: Text(seller.businessName.isEmpty ? '?' : seller.businessName[0].toUpperCase())),
          title: Text(seller.businessName, style: const TextStyle(fontWeight: FontWeight.w700)),
          subtitle: Text(seller.city),
          trailing: seller.ratingCount == 0
              ? null
              : Row(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.star_rounded, color: AppColors.amber, size: 20),
                  Text(' ${seller.rating.toStringAsFixed(1)} (${seller.ratingCount})'),
                ]),
        ),
      ),
    );
  }
}

/// The action bar: what the viewer can do right now.
class _BottomBar extends ConsumerWidget {
  const _BottomBar({required this.view});
  final AuctionView view;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    final lang = s.lang;
    final d = view.detail;
    final user = ref.watch(currentUserProvider);
    final viewer = d.viewer;
    // Rebuild every second so "starts soon" turns into "place a bid" on time.
    ref.watch(serverNowProvider);
    final now = ref.read(serverClockProvider).now();
    final fee = d.bidding.bidFee.format(languageCode: lang);

    Widget bar(Widget button, {String? caption}) => SafeArea(
          child: Container(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surface,
              border: Border(top: BorderSide(color: Theme.of(context).colorScheme.outlineVariant)),
            ),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              if (caption != null) ...[Text(caption, style: Theme.of(context).textTheme.bodySmall, textAlign: TextAlign.center), const SizedBox(height: 6)],
              SizedBox(width: double.infinity, child: button),
            ]),
          ),
        );

    if (d.card.isClosed) {
      if (viewer?.myStatus == 'WON') return bar(FilledButton.icon(onPressed: () => context.push('/won'), icon: const Icon(Icons.payments_outlined), label: Text(s.payNow)));
      if (d.result != null && d.result!.paidBids > 0) {
        return bar(OutlinedButton.icon(onPressed: () => context.push('/auctions/${d.id}/bids'), icon: const Icon(Icons.leaderboard_outlined), label: Text(s.seeResults)));
      }
      return bar(FilledButton(onPressed: null, child: Text(d.card.status == 'CANCELLED' ? s.auctionCancelled : s.auctionEnded)));
    }
    if (now.isAfter(d.card.endsAt)) {
      // Bidding is over; the result is being confirmed.
      return bar(FilledButton(onPressed: null, child: Text(s.auctionEnded)), caption: s.bidsRevealedAtEnd);
    }
    if (user == null) {
      return bar(FilledButton(onPressed: () => requireSignedIn(context, ref, returnTo: '/auctions/${d.id}'), child: Text(s.signInToContinue)));
    }
    if (!user.phoneVerified) {
      return bar(FilledButton(onPressed: () => startPhoneVerification(context, ref, from: '/auctions/${d.id}'), child: Text(s.verifyToBid)));
    }
    if (now.isBefore(d.card.startsAt)) {
      return bar(FilledButton(onPressed: null, child: Text(s.startsSoon)), caption: formatDateTime(d.card.startsAt, lang));
    }
    if (view.myBids.length >= d.bidding.maxBidsPerUser) {
      return bar(FilledButton(onPressed: null, child: Text(s.bidLimitReached)));
    }

    Future<void> startBid() async {
      final placed = await showBidSheet(context, d.id);
      if (placed != null && context.mounted) await openCheckout(context, placed.payment);
    }

    final hasBids = view.myBids.isNotEmpty;
    return bar(
      FilledButton.icon(
        onPressed: startBid,
        icon: const Icon(Icons.gavel),
        label: Text(hasBids ? s.placeAnotherBid : s.placeBid),
      ),
      caption: hasBids ? '${s.yourBidsCount(view.myBids.length)} · ${s.bidFeeEach(fee)}' : s.bidFeeEach(fee),
    );
  }
}
