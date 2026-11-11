import '../../core/money/money.dart';
import 'json.dart';

export 'json.dart';

// ───────────────────────────── Users ─────────────────────────────

class UserModel {
  const UserModel({
    required this.id,
    required this.phone,
    required this.firstName,
    required this.lastName,
    required this.locale,
    required this.phoneVerified,
    required this.roles,
    required this.permissions,
    this.email,
  });

  final String id;
  final String phone;
  final String? email;
  final String firstName;
  final String lastName;
  final String locale;
  final bool phoneVerified;
  final List<String> roles;
  final List<String> permissions;

  String get fullName => '$firstName $lastName'.trim();
  String get initials => '${firstName.isEmpty ? '' : firstName[0]}${lastName.isEmpty ? '' : lastName[0]}'.toUpperCase();
  bool can(String permission) => permissions.contains(permission);

  factory UserModel.fromJson(Json j) => UserModel(
        id: str(j['id']),
        phone: str(j['phone']),
        email: strOrNull(j['email']),
        firstName: str(j['firstName']),
        lastName: str(j['lastName']),
        locale: str(j['locale'], 'en'),
        phoneVerified: toBool(j['phoneVerified']),
        roles: strings(j['roles']),
        permissions: strings(j['permissions']),
      );
}

// ───────────────────────────── Catalog ─────────────────────────────

class ImageUrls {
  const ImageUrls({required this.sm, required this.md, required this.lg});

  final String sm;
  final String md;
  final String lg;

  static ImageUrls? fromJson(Object? v) {
    final j = asJson(v);
    if (j['sm'] == null) return null;
    return ImageUrls(sm: str(j['sm']), md: str(j['md'], str(j['sm'])), lg: str(j['lg'], str(j['md'])));
  }
}

class CategoryModel {
  const CategoryModel({
    required this.id,
    required this.slug,
    required this.nameEn,
    required this.nameAm,
    required this.defaultBidFee,
    this.iconKey,
    this.children = const [],
    this.openAuctions,
  });

  final int id;
  final String slug;
  final String nameEn;
  final String nameAm;
  final String? iconKey;
  final Money defaultBidFee; // zero = the platform default
  final List<CategoryModel> children;
  final int? openAuctions;

  String name(String lang) => lang == 'am' && nameAm.isNotEmpty ? nameAm : nameEn;

  /// Categories a product can be listed in: those with no subcategories.
  Iterable<CategoryModel> get leaves sync* {
    if (children.isEmpty) {
      yield this;
    } else {
      for (final c in children) {
        yield* c.leaves;
      }
    }
  }

  factory CategoryModel.fromJson(Json j) => CategoryModel(
        id: toInt(j['id']),
        slug: str(j['slug']),
        nameEn: str(j['nameEn']),
        nameAm: str(j['nameAm']),
        iconKey: strOrNull(j['iconKey']),
        defaultBidFee: Money.fromJson(j['defaultBidFee']) ?? Money.zero,
        children: listOf(j['children'], CategoryModel.fromJson),
        openAuctions: j['openAuctions'] == null ? null : toInt(j['openAuctions']),
      );
}

class CategoryRef {
  const CategoryRef({required this.slug, required this.nameEn, required this.nameAm});

  final String slug;
  final String nameEn;
  final String nameAm;

  String name(String lang) => lang == 'am' && nameAm.isNotEmpty ? nameAm : nameEn;

  static CategoryRef? fromJson(Object? v) {
    final j = asJson(v);
    if (j['slug'] == null) return null;
    return CategoryRef(slug: str(j['slug']), nameEn: str(j['nameEn']), nameAm: str(j['nameAm']));
  }
}

/// What an auction card shows. Deliberately has no price: cards never show prices.
class AuctionCardModel {
  const AuctionCardModel({
    required this.id,
    required this.title,
    required this.condition,
    required this.location,
    required this.highlights,
    required this.isFeatured,
    required this.bidCount,
    required this.status,
    required this.startsAt,
    required this.endsAt,
    this.coverImage,
    this.category,
    this.myStatus,
  });

  final String id;
  final String title;
  final String condition;
  final String location;
  final List<String> highlights;
  final ImageUrls? coverImage;
  final CategoryRef? category;
  final bool isFeatured;
  final int bidCount;
  final String status; // SCHEDULED, LIVE, CLOSED, CANCELLED
  final DateTime startsAt;
  final DateTime endsAt;
  final String? myStatus; // BIDDING, WON, LOST, CANCELLED (my bids only)

  bool get isClosed => status == 'CLOSED' || status == 'CANCELLED';
  bool get isLive => status == 'LIVE';

  AuctionCardModel copyWith({int? bidCount, DateTime? endsAt, String? status}) => AuctionCardModel(
        id: id,
        title: title,
        condition: condition,
        location: location,
        highlights: highlights,
        coverImage: coverImage,
        category: category,
        isFeatured: isFeatured,
        bidCount: bidCount ?? this.bidCount,
        status: status ?? this.status,
        startsAt: startsAt,
        endsAt: endsAt ?? this.endsAt,
        myStatus: myStatus,
      );

  factory AuctionCardModel.fromJson(Json j) {
    final now = DateTime.now().toUtc();
    return AuctionCardModel(
      id: str(j['id']),
      title: str(j['title']),
      condition: str(j['condition']),
      location: str(j['location']),
      highlights: strings(j['highlights']).take(3).toList(),
      coverImage: ImageUrls.fromJson(j['coverImage']),
      category: CategoryRef.fromJson(j['category']),
      isFeatured: toBool(j['isFeatured']),
      bidCount: toInt(j['bidCount']),
      status: str(j['status']),
      startsAt: dateOr(j['startsAt'], now),
      endsAt: dateOr(j['endsAt'], now),
      myStatus: strOrNull(j['myStatus']),
    );
  }
}

class SpecRow {
  const SpecRow(this.label, this.value);
  final String label;
  final String value;
  Json toJson() => {'label': label, 'value': value};
}

class SpecGroup {
  const SpecGroup(this.group, this.rows);
  final String group;
  final List<SpecRow> rows;

  Json toJson() => {'group': group, 'rows': rows.map((r) => r.toJson()).toList()};

  factory SpecGroup.fromJson(Json j) =>
      SpecGroup(str(j['group']), listOf(j['rows'], (r) => SpecRow(str(r['label']), str(r['value']))));
}

class SellerSummary {
  const SellerSummary({required this.id, required this.businessName, required this.city, required this.rating, required this.ratingCount});

  final String id;
  final String businessName;
  final String city;
  final double rating;
  final int ratingCount;

  static SellerSummary? fromJson(Object? v) {
    final j = asJson(v);
    if (j['id'] == null) return null;
    return SellerSummary(id: str(j['id']), businessName: str(j['businessName']), city: str(j['city']), rating: toDouble(j['rating']), ratingCount: toInt(j['ratingCount']));
  }
}

/// How bidding works on one auction. Every bid costs [bidFee]; amounts go from [minBid] to
/// [maxBid] in steps of [bidStep]. The lowest amount that only one person bid wins.
class BiddingTerms {
  const BiddingTerms({
    required this.bidFee,
    required this.minBid,
    required this.maxBid,
    required this.bidStep,
    required this.maxBidsPerUser,
    required this.minPaidBids,
  });

  final Money bidFee;
  final Money minBid;
  final Money maxBid;
  final Money bidStep;
  final int maxBidsPerUser;
  final int minPaidBids;

  /// Null when [amount] is acceptable, else the reason code (matches the server's error codes).
  String? check(Money amount) {
    if (amount < minBid || amount > maxBid) return 'BID_OUT_OF_RANGE';
    if (bidStep.minor > BigInt.zero && amount.minor % bidStep.minor != BigInt.zero) return 'BID_STEP_INVALID';
    return null;
  }

  factory BiddingTerms.fromJson(Json j) => BiddingTerms(
        bidFee: Money.fromJson(j['bidFee']) ?? Money.zero,
        minBid: Money.fromJson(j['minBid']) ?? Money(BigInt.one),
        maxBid: Money.fromJson(j['maxBid']) ?? Money.zero,
        bidStep: Money.fromJson(j['bidStep']) ?? Money(BigInt.one),
        maxBidsPerUser: toInt(j['maxBidsPerUser'], 50),
        minPaidBids: toInt(j['minPaidBids']),
      );
}

/// Revealed when the auction closes.
class AuctionOutcome {
  const AuctionOutcome({required this.outcome, required this.paidBids, required this.uniqueBids, this.finalPrice, this.winnerAlias});

  final String outcome; // SOLD, NO_BIDS, NOT_ENOUGH_BIDS
  final Money? finalPrice;
  final String? winnerAlias;
  final int paidBids;
  final int uniqueBids;

  static AuctionOutcome? fromJson(Object? v) {
    if (v is! Map) return null;
    final j = asJson(v);
    return AuctionOutcome(
      outcome: str(j['outcome']),
      finalPrice: Money.fromJson(j['finalPrice']),
      winnerAlias: strOrNull(j['winnerAlias']),
      paidBids: toInt(j['paidBids']),
      uniqueBids: toInt(j['uniqueBids']),
    );
  }
}

class AuctionDetailModel {
  const AuctionDetailModel({
    required this.card,
    required this.description,
    required this.images,
    required this.specs,
    required this.bidding,
    this.marketValue,
    this.seller,
    this.viewer,
    this.result,
  });

  final AuctionCardModel card;
  final String description;
  final List<ImageUrls> images;
  final List<SpecGroup> specs;
  final SellerSummary? seller;
  final BiddingTerms bidding;
  final Money? marketValue;
  final ViewerInfo? viewer;
  final AuctionOutcome? result;

  String get id => card.id;

  AuctionDetailModel copyWith({AuctionCardModel? card, ViewerInfo? viewer, AuctionOutcome? result}) => AuctionDetailModel(
        card: card ?? this.card,
        description: description,
        images: images,
        specs: specs,
        seller: seller,
        bidding: bidding,
        marketValue: marketValue,
        viewer: viewer ?? this.viewer,
        result: result ?? this.result,
      );

  factory AuctionDetailModel.fromJson(Json j) => AuctionDetailModel(
        card: AuctionCardModel.fromJson(j),
        description: str(j['description']),
        images: listOf(j['images'], (e) => ImageUrls.fromJson(e)!),
        specs: listOf(j['specs'], SpecGroup.fromJson),
        seller: SellerSummary.fromJson(j['seller']),
        bidding: BiddingTerms.fromJson(asJson(j['bidding'])),
        marketValue: Money.fromJson(j['marketValue']),
        viewer: j['viewer'] == null ? null : ViewerInfo.fromJson(asJson(j['viewer'])),
        result: AuctionOutcome.fromJson(j['result']),
      );
}

class ViewerInfo {
  const ViewerInfo({required this.isWatching, this.myBidCount = 0, this.myPendingCount = 0, this.myStatus});

  final bool isWatching;
  final int myBidCount; // paid bids
  final int myPendingCount; // bids whose fee is not confirmed yet
  final String? myStatus; // BIDDING, WON, LOST, CANCELLED

  ViewerInfo copyWith({bool? isWatching, int? myBidCount, int? myPendingCount, String? myStatus}) => ViewerInfo(
        isWatching: isWatching ?? this.isWatching,
        myBidCount: myBidCount ?? this.myBidCount,
        myPendingCount: myPendingCount ?? this.myPendingCount,
        myStatus: myStatus ?? this.myStatus,
      );

  factory ViewerInfo.fromJson(Json j) => ViewerInfo(
        isWatching: toBool(j['isWatching']),
        myBidCount: toInt(j['myBidCount']),
        myPendingCount: toInt(j['myPendingCount']),
        myStatus: strOrNull(j['myStatus']),
      );
}

/// One of my own bids (I always know my amounts; nobody else does until the close).
class MyBid {
  const MyBid({required this.id, required this.amount, required this.status, required this.createdAt, this.txRef, this.checkoutUrl});

  final String id;
  final Money amount;
  final String status; // PENDING_PAYMENT, ACTIVE
  final DateTime createdAt;
  final String? txRef;
  final String? checkoutUrl; // to finish paying the fee

  bool get isPaid => status == 'ACTIVE';

  factory MyBid.fromJson(Json j) => MyBid(
        id: str(j['id']),
        amount: Money.fromJson(j['amount']) ?? Money.zero,
        status: str(j['status']),
        createdAt: dateOr(j['createdAt'], DateTime.now().toUtc()),
        txRef: strOrNull(j['txRef']),
        checkoutUrl: strOrNull(j['checkoutUrl']),
      );
}

/// One row of the revealed ranking after the close.
class BidEntry {
  const BidEntry({
    required this.id,
    required this.rank,
    required this.amount,
    required this.unique,
    required this.isWinning,
    required this.bidderAlias,
    required this.isYou,
    required this.createdAt,
  });

  final String id;
  final int rank;
  final Money amount;
  final bool unique;
  final bool isWinning;
  final String bidderAlias;
  final bool isYou;
  final DateTime createdAt;

  factory BidEntry.fromJson(Json j) => BidEntry(
        id: str(j['id']),
        rank: toInt(j['rank']),
        amount: Money.fromJson(j['amount']) ?? Money.zero,
        unique: toBool(j['unique']),
        isWinning: toBool(j['isWinning']),
        bidderAlias: str(j['bidderAlias']),
        isYou: toBool(j['isYou']),
        createdAt: dateOr(j['createdAt'], DateTime.now().toUtc()),
      );
}

class HomeData {
  const HomeData({
    required this.banners,
    required this.featured,
    required this.endingSoon,
    required this.live,
    required this.upcoming,
    required this.recentlyAdded,
    required this.popularCategories,
  });

  final List<BannerModel> banners;
  final List<AuctionCardModel> featured;
  final List<AuctionCardModel> endingSoon;
  final List<AuctionCardModel> live;
  final List<AuctionCardModel> upcoming;
  final List<AuctionCardModel> recentlyAdded;
  final List<CategoryModel> popularCategories;

  bool get isEmpty => featured.isEmpty && endingSoon.isEmpty && live.isEmpty && upcoming.isEmpty && recentlyAdded.isEmpty;

  factory HomeData.fromJson(Json j) => HomeData(
        banners: listOf(j['banners'], BannerModel.fromJson),
        featured: listOf(j['featured'], AuctionCardModel.fromJson),
        endingSoon: listOf(j['endingSoon'], AuctionCardModel.fromJson),
        live: listOf(j['live'], AuctionCardModel.fromJson),
        upcoming: listOf(j['upcoming'], AuctionCardModel.fromJson),
        recentlyAdded: listOf(j['recentlyAdded'], AuctionCardModel.fromJson),
        popularCategories: listOf(j['popularCategories'], CategoryModel.fromJson),
      );
}

class BannerModel {
  const BannerModel({required this.titleEn, required this.titleAm, required this.imageUrl, required this.linkType, this.linkValue});

  final String titleEn;
  final String titleAm;
  final String imageUrl;
  final String linkType; // NONE, AUCTION, CATEGORY, URL
  final String? linkValue;

  String title(String lang) => lang == 'am' && titleAm.isNotEmpty ? titleAm : titleEn;

  factory BannerModel.fromJson(Json j) => BannerModel(
        titleEn: str(j['titleEn']),
        titleAm: str(j['titleAm']),
        imageUrl: str(j['imageUrl']),
        linkType: str(j['linkType'], 'NONE'),
        linkValue: strOrNull(j['linkValue']),
      );
}

// ───────────────────────────── Won items, notifications ─────────────────────────────

class WonItem {
  const WonItem({required this.card, required this.status, required this.totalDue, this.finalPrice, this.paymentDeadline, this.paidAt, this.txRef});

  final AuctionCardModel card;
  final String status; // AWAITING_PAYMENT, PAID, FULFILLED, DISPUTED, PAYMENT_EXPIRED, CANCELLED
  final Money? finalPrice;
  final Money totalDue;
  final DateTime? paymentDeadline;
  final DateTime? paidAt;
  final String? txRef; // the paid checkout, for the receipt and refund requests

  factory WonItem.fromJson(Json j) {
    final r = asJson(j['result']);
    return WonItem(
      card: AuctionCardModel.fromJson(j),
      status: str(r['status']),
      finalPrice: Money.fromJson(r['finalPrice']),
      totalDue: Money.fromJson(r['totalDue']) ?? Money.zero,
      paymentDeadline: date(r['paymentDeadline']),
      paidAt: date(r['paidAt']),
      txRef: strOrNull(r['txRef']),
    );
  }
}

class NotificationModel {
  const NotificationModel({required this.id, required this.type, required this.title, required this.body, required this.data, required this.read, required this.createdAt});

  final String id;
  final String type;
  final String title;
  final String body;
  final Json data;
  final bool read;
  final DateTime createdAt;

  String? get auctionId => strOrNull(data['auctionId']);
  String? get txRef => strOrNull(data['txRef']);

  NotificationModel markRead() => NotificationModel(id: id, type: type, title: title, body: body, data: data, read: true, createdAt: createdAt);

  factory NotificationModel.fromJson(Json j) => NotificationModel(
        id: str(j['id']),
        type: str(j['type']),
        title: str(j['title']),
        body: str(j['body']),
        data: asJson(j['data']),
        read: toBool(j['read']),
        createdAt: dateOr(j['createdAt'], DateTime.now().toUtc()),
      );
}

// ───────────────────────────── Payments ─────────────────────────────

class PaymentModel {
  const PaymentModel({
    required this.txRef,
    required this.purpose,
    required this.status,
    required this.amount,
    this.checkoutUrl,
    this.receiptNo,
    this.auctionId,
    this.createdAt,
    this.reused = false,
  });

  final String txRef;
  final String purpose; // BID_FEE, WINNING_BID
  final String status;
  final Money amount;
  final String? bidId; // set for bid fees
  final String? checkoutUrl;
  final String? receiptNo;
  final String? auctionId;
  final DateTime? createdAt;
  final bool reused;

  bool get isPending => status == 'INITIATED' || status == 'PENDING';
  bool get isPaid => status == 'PAID' || status == 'PARTIALLY_REFUNDED' || status == 'REFUNDED';

  factory PaymentModel.fromJson(Json j) => PaymentModel(
        txRef: str(j['txRef']),
        purpose: str(j['purpose']),
        status: str(j['status']),
        amount: Money.fromJson(j['amount']) ?? Money.zero,
        bidId: strOrNull(j['bidId']),
        checkoutUrl: strOrNull(j['checkoutUrl']),
        receiptNo: strOrNull(j['receiptNo']),
        auctionId: strOrNull(j['auctionId']),
        createdAt: date(j['createdAt']),
        reused: toBool(j['reused']),
      );
}

class ReceiptModel {
  const ReceiptModel({
    required this.receiptNo,
    required this.issuedAt,
    required this.customerName,
    required this.customerPhone,
    required this.item,
    required this.lines,
    required this.totalPaid,
    required this.txRef,
    this.paymentMethod,
    this.providerReference,
  });

  final String receiptNo;
  final DateTime? issuedAt;
  final String customerName;
  final String customerPhone;
  final String item;
  final List<(String, Money)> lines;
  final Money totalPaid;
  final String txRef;
  final String? paymentMethod;
  final String? providerReference;

  factory ReceiptModel.fromJson(Json j) {
    final c = asJson(j['customer']);
    return ReceiptModel(
      receiptNo: str(j['receiptNo']),
      issuedAt: date(j['issuedAt']),
      customerName: str(c['name']),
      customerPhone: str(c['phone']),
      item: str(j['item']),
      lines: listOf(j['lines'], (l) => (str(l['label']), Money.fromJson(l['amount']) ?? Money.zero)),
      totalPaid: Money.fromJson(j['totalPaid']) ?? Money.zero,
      txRef: str(j['txRef']),
      paymentMethod: strOrNull(j['paymentMethod']),
      providerReference: strOrNull(j['providerReference']),
    );
  }
}
