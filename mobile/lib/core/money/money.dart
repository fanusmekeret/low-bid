/// An exact amount of Ethiopian birr. Stored as santim (1 ETB = 100 santim) in a BigInt,
/// exactly as the API sends it. The app never does floating-point maths on money.
class Money implements Comparable<Money> {
  const Money(this.minor);

  final BigInt minor;

  static final Money zero = Money(BigInt.zero);

  /// API shape: { "minor": "16400000", "etb": "164000.00", "currency": "ETB" }
  static Money? fromJson(Object? json) {
    if (json is Map && json['minor'] != null) return Money(BigInt.parse(json['minor'].toString()));
    return null;
  }

  /// Parses what a user typed: "165000", "165,000", "165000.5". Returns null if invalid.
  static Money? tryParseEtb(String input) {
    final text = input.replaceAll(',', '').replaceAll(' ', '').trim();
    final match = RegExp(r'^(\d{1,13})(?:\.(\d{1,2}))?$').firstMatch(text);
    if (match == null) return null;
    final whole = BigInt.parse(match.group(1)!);
    final fraction = BigInt.parse((match.group(2) ?? '').padRight(2, '0'));
    return Money(whole * BigInt.from(100) + fraction);
  }

  Money operator +(Money other) => Money(minor + other.minor);
  Money operator -(Money other) => Money(minor - other.minor);
  Money times(int n) => Money(minor * BigInt.from(n));
  bool operator <(Money other) => minor < other.minor;
  bool operator >(Money other) => minor > other.minor;
  bool operator <=(Money other) => minor <= other.minor;
  bool operator >=(Money other) => minor >= other.minor;

  /// "165000" or "165000.50": the form the API accepts for amounts.
  String toApiString() {
    final whole = minor ~/ BigInt.from(100);
    final cents = (minor % BigInt.from(100)).toInt();
    return cents == 0 ? '$whole' : '$whole.${cents.toString().padLeft(2, '0')}';
  }

  /// "ETB 164,000" (English) or "164,000 ብር" (Amharic). Cents shown only when not zero.
  String format({String languageCode = 'en', bool showCents = false}) {
    final negative = minor.isNegative;
    final abs = negative ? -minor : minor;
    final whole = (abs ~/ BigInt.from(100)).toString();
    final cents = (abs % BigInt.from(100)).toInt();
    final grouped = whole.replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
    final number = (cents != 0 || showCents) ? '$grouped.${cents.toString().padLeft(2, '0')}' : grouped;
    final signed = negative ? '-$number' : number;
    return languageCode == 'am' ? '$signed ብር' : 'ETB $signed';
  }

  @override
  int compareTo(Money other) => minor.compareTo(other.minor);

  @override
  bool operator ==(Object other) => other is Money && other.minor == minor;

  @override
  int get hashCode => minor.hashCode;

  @override
  String toString() => format();
}
