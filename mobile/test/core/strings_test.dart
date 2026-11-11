import 'package:flutter_test/flutter_test.dart';
import 'package:lowbid/core/l10n/app_strings.dart';
import 'package:lowbid/core/network/api_exception.dart';

void main() {
  test('English and Amharic have exactly the same keys', () {
    final missingInAm = S.en.keys.toSet().difference(S.am.keys.toSet());
    final extraInAm = S.am.keys.toSet().difference(S.en.keys.toSet());
    expect(missingInAm, isEmpty, reason: 'Add Amharic for: $missingInAm');
    expect(extraInAm, isEmpty, reason: 'Unknown keys in Amharic: $extraInAm');
  });

  test('no translation is empty', () {
    for (final map in [S.en, S.am]) {
      for (final e in map.entries) {
        expect(e.value.trim(), isNotEmpty, reason: e.key);
      }
    }
  });

  test('server error codes are translated, unknown codes fall back', () {
    const en = S('en');
    const am = S('am');
    const dup = ApiException(code: 'DUPLICATE_BID_AMOUNT', message: 'x', statusCode: 409);
    expect(en.error(dup), 'You already bid this amount. Choose a different one.');
    expect(am.error(dup), isNot(en.error(dup)));
    const unknown = ApiException(code: 'SOMETHING_NEW', message: 'Server says hi', statusCode: 400);
    expect(en.error(unknown), isNotEmpty);
  });

  test('parameterised strings fill in their values', () {
    const en = S('en');
    expect(en.bids(1), contains('1'));
    expect(en.bids(12), contains('12'));
    expect(en.bidFeeEach('ETB 10'), contains('ETB 10'));
  });
}
