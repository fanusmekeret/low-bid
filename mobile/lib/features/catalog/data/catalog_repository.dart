import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/money/money.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/models/models.dart';

/// A new bid: recorded (secret) and waiting for its fee, plus the Chapa checkout for that fee.
class PlacedBid {
  const PlacedBid({required this.bid, required this.payment, required this.replay});

  final MyBid bid;
  final PaymentModel payment;
  final bool replay;

  factory PlacedBid.fromJson(Json j) => PlacedBid(
        bid: MyBid.fromJson(asJson(j['bid'])),
        payment: PaymentModel.fromJson(asJson(j['payment'])),
        replay: toBool(j['replay']),
      );
}

class CatalogRepository {
  CatalogRepository(this._api);

  final ApiClient _api;

  Future<HomeData> home() async => HomeData.fromJson(asJson((await _api.get('/home'))['data']));

  Future<List<CategoryModel>> categories() async => listOf((await _api.get('/categories'))['data'], CategoryModel.fromJson);

  Future<Paged<AuctionCardModel>> search({
    String status = 'open',
    String? category,
    String? q,
    String? condition,
    String sort = 'ending_soon',
    int page = 1,
  }) async {
    final body = await _api.get('/auctions', query: {
      'status': status,
      'category': category,
      'q': q,
      'condition': condition,
      'sort': sort,
      'page': page,
      'pageSize': 20,
    });
    return Paged.fromResponse(body, AuctionCardModel.fromJson);
  }

  Future<AuctionDetailModel> detail(String id) async => AuctionDetailModel.fromJson(asJson((await _api.get('/auctions/$id'))['data']));

  /// The revealed ranking. Only available after the auction closes (403 BIDS_SECRET before).
  Future<Paged<BidEntry>> results(String id, {String? cursor, int limit = 50}) async =>
      Paged.fromResponse(await _api.get('/auctions/$id/bids', query: {'cursor': cursor, 'limit': limit}), BidEntry.fromJson);

  /// My own bids on one auction, lowest amount first.
  Future<List<MyBid>> myBidsOn(String id) async => listOf((await _api.get('/auctions/$id/bids/mine'))['data'], MyBid.fromJson);

  /// The client sends only the amount and a fresh idempotency key; the server checks everything
  /// and returns the checkout for the bid fee. The bid counts once that fee is confirmed.
  Future<PlacedBid> placeBid(String id, Money amount, String idempotencyKey) async {
    final body = await _api.post('/auctions/$id/bids', data: {'amount': amount.toApiString(), 'idempotencyKey': idempotencyKey});
    return PlacedBid.fromJson(asJson(body['data']));
  }

  Future<void> watch(String id) => _api.post('/auctions/$id/watch');
  Future<void> unwatch(String id) => _api.delete('/auctions/$id/watch');

  Future<Paged<AuctionCardModel>> myBids(String status, {int page = 1}) async =>
      Paged.fromResponse(await _api.get('/me/bids', query: {'status': status, 'page': page}), AuctionCardModel.fromJson);

  Future<Paged<WonItem>> won({int page = 1}) async => Paged.fromResponse(await _api.get('/me/auctions/won', query: {'page': page}), WonItem.fromJson);

  Future<Paged<AuctionCardModel>> watchlist({String status = 'active', int page = 1}) async =>
      Paged.fromResponse(await _api.get('/me/watchlist', query: {'status': status, 'page': page}), AuctionCardModel.fromJson);

  Future<void> confirmReceived(String auctionId) => _api.post('/me/auctions/$auctionId/confirm-received');

  Future<(Paged<NotificationModel>, int)> notifications({String? cursor}) async {
    final body = await _api.get('/notifications', query: {'cursor': cursor, 'limit': 30});
    return (Paged.fromResponse(body, NotificationModel.fromJson), toInt(asJson(body['meta'])['unreadCount']));
  }

  Future<void> markRead(String id) => _api.post('/notifications/$id/read');
  Future<void> markAllRead() => _api.post('/notifications/read-all');
}

final catalogRepositoryProvider = Provider<CatalogRepository>((ref) => CatalogRepository(ref.watch(apiClientProvider)));

final homeProvider = FutureProvider.autoDispose<HomeData>((ref) => ref.watch(catalogRepositoryProvider).home());

/// Categories change rarely: loaded once per app session.
final categoriesProvider = FutureProvider<List<CategoryModel>>((ref) => ref.watch(catalogRepositoryProvider).categories());

final myBidsProvider = FutureProvider.autoDispose.family<Paged<AuctionCardModel>, String>((ref, status) => ref.watch(catalogRepositoryProvider).myBids(status));
final wonProvider = FutureProvider.autoDispose<Paged<WonItem>>((ref) => ref.watch(catalogRepositoryProvider).won());
final watchlistProvider = FutureProvider.autoDispose<Paged<AuctionCardModel>>((ref) => ref.watch(catalogRepositoryProvider).watchlist());
