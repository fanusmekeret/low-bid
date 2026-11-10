// Small, forgiving JSON helpers: the API is the source of truth, and a missing optional
// field must never crash a screen.

typedef Json = Map<String, dynamic>;

Json asJson(Object? v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

String str(Object? v, [String fallback = '']) => v?.toString() ?? fallback;
String? strOrNull(Object? v) => v?.toString();
int toInt(Object? v, [int fallback = 0]) => v is int ? v : int.tryParse(v?.toString() ?? '') ?? fallback;
bool toBool(Object? v) => v == true || v == 'true';
double toDouble(Object? v) => v is num ? v.toDouble() : double.tryParse(v?.toString() ?? '') ?? 0;

DateTime? date(Object? v) => v == null ? null : DateTime.tryParse(v.toString())?.toUtc();
DateTime dateOr(Object? v, DateTime fallback) => date(v) ?? fallback;

List<T> listOf<T>(Object? v, T Function(Json) parse) =>
    v is List ? v.whereType<Map>().map((e) => parse(Map<String, dynamic>.from(e))).toList() : <T>[];

List<String> strings(Object? v) => v is List ? v.map((e) => e.toString()).toList() : const <String>[];

/// A page of results plus how to get the next one.
class Paged<T> {
  const Paged({required this.items, this.page = 1, this.totalPages = 1, this.total, this.nextCursor});

  final List<T> items;
  final int page;
  final int totalPages;
  final int? total;
  final String? nextCursor;

  bool get hasMore => nextCursor != null || page < totalPages;

  static Paged<T> fromResponse<T>(Json body, T Function(Json) parse) {
    final meta = asJson(body['meta']);
    return Paged<T>(
      items: listOf(body['data'], parse),
      page: toInt(meta['page'], 1),
      totalPages: toInt(meta['totalPages'], 1),
      total: meta['total'] == null ? null : toInt(meta['total']),
      nextCursor: strOrNull(meta['nextCursor']),
    );
  }
}
