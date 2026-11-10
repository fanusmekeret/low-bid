import 'package:flutter_test/flutter_test.dart';
import 'package:lowbid/core/money/money.dart';

void main() {
  group('Money', () {
    test('parses the API shape exactly (santim in a string)', () {
      final m = Money.fromJson({'minor': '16400000', 'etb': '164000.00', 'currency': 'ETB'})!;
      expect(m.minor, BigInt.from(16400000));
      expect(m.toApiString(), '164000');
    });

    test('handles amounts beyond the 53-bit double range without rounding', () {
      final m = Money.fromJson({'minor': '900719925474099312'})!;
      expect(m.minor.toString(), '900719925474099312');
    });

    test('fromJson returns null for missing values', () {
      expect(Money.fromJson(null), isNull);
      expect(Money.fromJson({'etb': '1'}), isNull);
    });

    test('parses what people type', () {
      expect(Money.tryParseEtb('165000')!.minor, BigInt.from(16500000));
      expect(Money.tryParseEtb('165,000')!.minor, BigInt.from(16500000));
      expect(Money.tryParseEtb(' 165000.5 ')!.minor, BigInt.from(16500050));
      expect(Money.tryParseEtb('165000.05')!.minor, BigInt.from(16500005));
    });

    test('rejects invalid input', () {
      for (final bad in ['', 'abc', '1.234', '-5', '1e5', '12.']) {
        expect(Money.tryParseEtb(bad), isNull, reason: bad);
      }
    });

    test('formats in English and Amharic', () {
      final m = Money(BigInt.from(16400000));
      expect(m.format(), 'ETB 164,000');
      expect(m.format(languageCode: 'am'), '164,000 ብር');
      expect(m.format(showCents: true), 'ETB 164,000.00');
      expect(Money(BigInt.from(5050)).format(), 'ETB 50.50');
    });

    test('toApiString keeps cents only when needed', () {
      expect(Money(BigInt.from(5000)).toApiString(), '50');
      expect(Money(BigInt.from(5005)).toApiString(), '50.05');
    });

    test('arithmetic and comparison', () {
      final a = Money(BigInt.from(100000));
      final inc = Money(BigInt.from(50000));
      expect((a + inc).minor, BigInt.from(150000));
      expect(inc.times(3).minor, BigInt.from(150000));
      expect(a > inc, isTrue);
      expect(a >= Money(BigInt.from(100000)), isTrue);
      expect(a == Money(BigInt.from(100000)), isTrue);
    });
  });
}
