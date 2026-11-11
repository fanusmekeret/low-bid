import 'package:flutter_test/flutter_test.dart';
import 'package:lowbid/core/money/money.dart';
import 'package:lowbid/shared/models/models.dart';

Map<String, dynamic> money(int minor) => {'minor': '$minor', 'etb': (minor / 100).toStringAsFixed(2), 'currency': 'ETB'};

void main() {
  test('auction cards carry no price', () {
    final card = AuctionCardModel.fromJson({
      'id': '42',
      'title': 'Samsung Galaxy S24 Ultra 256GB',
      'condition': 'NEW',
      'location': 'Addis Ababa',
      'highlights': ['256GB', '12GB RAM', '5000mAh', 'ignored 4th'],
      'bidCount': 7,
      'status': 'LIVE',
      'startsAt': '2026-11-09T06:00:00.000Z',
      'endsAt': '2026-11-09T18:00:00.000Z',
    });
    expect(card.id, '42');
    expect(card.highlights, hasLength(3));
    expect(card.isLive, isTrue);
    expect(card.endsAt.isUtc, isTrue);
  });

  test('auction detail parses bidding terms, specs, viewer and the revealed result', () {
    final d = AuctionDetailModel.fromJson({
      'id': '7',
      'title': 'Toyota Vitz 2014',
      'condition': 'USED_GOOD',
      'status': 'CLOSED',
      'startsAt': '2026-11-09T06:00:00Z',
      'endsAt': '2026-11-10T06:00:00Z',
      'bidCount': 3,
      'description': 'Clean car',
      'images': [
        {'sm': 'a', 'md': 'b', 'lg': 'c'},
      ],
      'specs': [
        {
          'group': 'Engine',
          'rows': [
            {'label': 'Displacement', 'value': '1.0 L'},
          ],
        },
      ],
      'bidding': {'bidFee': money(5000), 'minBid': money(1), 'maxBid': money(120000000), 'bidStep': money(1), 'maxBidsPerUser': 50, 'minPaidBids': 0},
      'marketValue': money(135000000),
      'result': {'outcome': 'SOLD', 'finalPrice': money(245), 'winnerAlias': 'A***e · 7F3C', 'paidBids': 3, 'uniqueBids': 2},
      'viewer': {'isWatching': true, 'myBidCount': 2, 'myPendingCount': 1, 'myStatus': 'LOST'},
    });
    expect(d.bidding.bidFee.toApiString(), '50');
    expect(d.bidding.minBid.toApiString(), '0.01');
    expect(d.marketValue!.toApiString(), '1350000');
    expect(d.specs.single.rows.single.value, '1.0 L');
    expect(d.viewer!.myBidCount, 2);
    expect(d.viewer!.myPendingCount, 1);
    expect(d.result!.finalPrice!.toApiString(), '2.45');
    expect(d.result!.uniqueBids, 2);

    final updated = d.copyWith(card: d.card.copyWith(bidCount: 4));
    expect(updated.card.bidCount, 4);
    expect(updated.description, 'Clean car');
    expect(updated.result, isNotNull);
  });

  test('bidding terms check amounts the same way as the server', () {
    final b = BiddingTerms.fromJson({'bidFee': money(1000), 'minBid': money(100), 'maxBid': money(10000), 'bidStep': money(50), 'maxBidsPerUser': 5, 'minPaidBids': 0});
    expect(b.check(Money(BigInt.from(150))), isNull);
    expect(b.check(Money(BigInt.from(99))), 'BID_OUT_OF_RANGE');
    expect(b.check(Money(BigInt.from(10001))), 'BID_OUT_OF_RANGE');
    expect(b.check(Money(BigInt.from(175))), 'BID_STEP_INVALID');
  });

  test('my bids and revealed results parse', () {
    final mine = MyBid.fromJson({'id': '9', 'amount': money(3745), 'status': 'PENDING_PAYMENT', 'createdAt': '2026-11-09T10:00:00Z', 'txRef': 'LB-F-7-x', 'checkoutUrl': 'https://checkout.chapa.co/x'});
    expect(mine.isPaid, isFalse);
    expect(mine.amount.toApiString(), '37.45');
    final r = BidEntry.fromJson({'id': '9', 'rank': 1, 'amount': money(245), 'unique': true, 'isWinning': true, 'bidderAlias': 'A***e · 7F3C', 'isYou': false, 'createdAt': '2026-11-09T10:00:00Z'});
    expect(r.rank, 1);
    expect(r.unique && r.isWinning, isTrue);
  });

  test('payment states', () {
    PaymentModel p(String status) => PaymentModel.fromJson({'txRef': 'LB-F-1-x', 'purpose': 'BID_FEE', 'status': status, 'amount': money(1000), 'bidId': '5'});
    expect(p('PAID').bidId, '5');
    expect(p('PENDING').isPending, isTrue);
    expect(p('PAID').isPaid, isTrue);
    expect(p('PARTIALLY_REFUNDED').isPaid, isTrue);
    expect(p('FAILED').isPaid || p('FAILED').isPending, isFalse);
  });

  test('won items expose the paid checkout reference', () {
    final w = WonItem.fromJson({
      'id': '5',
      'title': 'Fridge',
      'status': 'CLOSED',
      'result': {'status': 'PAID', 'totalDue': money(2000000), 'txRef': 'LB-5-ABC'},
    });
    expect(w.status, 'PAID');
    expect(w.txRef, 'LB-5-ABC');
  });

  test('category leaves flatten the tree', () {
    final c = CategoryModel.fromJson({
      'id': 1,
      'slug': 'electronics',
      'nameEn': 'Electronics',
      'nameAm': 'ኤሌክትሮኒክስ',
      'children': [
        {'id': 2, 'slug': 'phones', 'nameEn': 'Phones', 'nameAm': 'ስልኮች'},
        {
          'id': 3,
          'slug': 'appliances',
          'nameEn': 'Appliances',
          'nameAm': '',
          'children': [
            {'id': 4, 'slug': 'fridges', 'nameEn': 'Fridges', 'nameAm': 'ማቀዝቀዣዎች'},
          ],
        },
      ],
    });
    expect(c.leaves.map((e) => e.id), [2, 4]);
    expect(c.children[1].name('am'), 'Appliances'); // falls back to English
  });
}
