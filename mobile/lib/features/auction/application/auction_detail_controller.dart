import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/money/money.dart';
import '../../../core/realtime/socket_service.dart';
import '../../../shared/models/models.dart';
import '../../auth/application/auth_controller.dart';
import '../../catalog/data/catalog_repository.dart';

/// What the auction screen shows: the auction plus the viewer's own (secret) bids.
class AuctionView {
  const AuctionView({required this.detail, required this.myBids});

  final AuctionDetailModel detail;
  final List<MyBid> myBids;

  List<MyBid> get paidBids => myBids.where((b) => b.isPaid).toList();
  List<MyBid> get unpaidBids => myBids.where((b) => !b.isPaid).toList();

  AuctionView copyWith({AuctionDetailModel? detail, List<MyBid>? myBids}) =>
      AuctionView(detail: detail ?? this.detail, myBids: myBids ?? this.myBids);
}

/// Loads one auction and joins its live room. While bidding is open the room only carries the
/// paid-bid count (amounts are secret); closing and cancelling trigger a reload, which brings
/// the revealed result. A confirmed bid fee also reloads, so "your bids" updates.
class AuctionDetailController extends AutoDisposeFamilyAsyncNotifier<AuctionView, String> {
  StreamSubscription<LiveEvent>? _sub;

  CatalogRepository get _repo => ref.read(catalogRepositoryProvider);

  @override
  Future<AuctionView> build(String auctionId) async {
    final signedIn = ref.watch(currentUserProvider.select((u) => u != null));
    final socket = ref.watch(socketServiceProvider);
    socket.join(auctionId);
    _sub?.cancel();
    _sub = socket.events.where((e) => e.auctionId == auctionId).listen(_onEvent);
    ref.onDispose(() {
      _sub?.cancel();
      socket.leave(auctionId);
    });
    return _load(auctionId, signedIn);
  }

  Future<AuctionView> _load(String id, bool signedIn) async {
    final detail = await _repo.detail(id);
    final mine = signedIn ? await _repo.myBidsOn(id).catchError((_) => const <MyBid>[]) : const <MyBid>[];
    return AuctionView(detail: detail, myBids: mine);
  }

  /// Quiet reload: keeps the current data on screen while fetching.
  Future<void> refresh() async {
    try {
      state = AsyncData(await _load(arg, ref.read(currentUserProvider) != null));
    } catch (e, st) {
      if (!state.hasValue) state = AsyncError(e, st);
    }
  }

  void _onEvent(LiveEvent e) {
    final view = state.valueOrNull;
    if (view == null) return;
    final d = view.detail;
    switch (e.name) {
      case 'auction:bid':
        final count = toInt(e.data['bidCount'], d.card.bidCount);
        state = AsyncData(view.copyWith(detail: d.copyWith(card: d.card.copyWith(bidCount: count, status: 'LIVE'))));
      case 'auction:started':
        state = AsyncData(view.copyWith(detail: d.copyWith(card: d.card.copyWith(status: 'LIVE', endsAt: date(e.data['endsAt'])))));
      case 'auction:closed':
      case 'auction:cancelled':
      case 'payment:updated': // one of my bid fees was confirmed (or refunded)
        refresh();
    }
  }

  /// Records a secret bid and returns the checkout for its fee. Throws ApiException when refused.
  /// Reuse the same [idempotencyKey] when retrying after a network failure.
  Future<PlacedBid> placeBid(Money amount, String idempotencyKey) async {
    final placed = await _repo.placeBid(arg, amount, idempotencyKey);
    final view = state.valueOrNull;
    if (view != null && !view.myBids.any((b) => b.id == placed.bid.id)) {
      final bid = MyBid(
        id: placed.bid.id,
        amount: placed.bid.amount,
        status: placed.bid.status,
        createdAt: placed.bid.createdAt,
        txRef: placed.payment.txRef,
        checkoutUrl: placed.payment.checkoutUrl,
      );
      final mine = [...view.myBids, bid]..sort((a, b) => a.amount.compareTo(b.amount));
      final viewer = view.detail.viewer;
      state = AsyncData(view.copyWith(
        myBids: mine,
        detail: viewer == null ? null : view.detail.copyWith(viewer: viewer.copyWith(myPendingCount: viewer.myPendingCount + 1)),
      ));
    }
    return placed;
  }

  /// Optimistic watchlist toggle; rolls back if the server refuses.
  Future<void> toggleWatch() async {
    final view = state.valueOrNull;
    final viewer = view?.detail.viewer;
    if (view == null || viewer == null) return;
    final watching = !viewer.isWatching;
    void set(bool w) {
      final v = state.valueOrNull;
      if (v == null) return;
      state = AsyncData(v.copyWith(detail: v.detail.copyWith(viewer: v.detail.viewer?.copyWith(isWatching: w))));
    }

    set(watching);
    try {
      watching ? await _repo.watch(arg) : await _repo.unwatch(arg);
    } catch (_) {
      set(!watching);
      rethrow;
    }
  }
}

final auctionDetailProvider = AsyncNotifierProvider.autoDispose.family<AuctionDetailController, AuctionView, String>(AuctionDetailController.new);
