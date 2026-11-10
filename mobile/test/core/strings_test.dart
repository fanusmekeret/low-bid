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
    const tooLow = ApiException(code: 'BID_TOO_LOW', message: 'x', statusCode: 409);
    expect(en.error(tooLow), 'Someone bid higher. Raise your bid.');
    expect(am.error(tooLow), isNot(en.error(tooLow)));
    const unknown = ApiException(code: 'SOMETHING_NEW', message: 'Server says hi', statusCode: 400);
    expect(en.error(unknown), isNotEmpty);
  });

  test('parameterised strings fill in their values', () {
    const en = S('en');
    expect(en.bids(1), contains('1'));
    expect(en.bids(12), contains('12'));
    expect(en.minimumIs('ETB 5,000'), contains('ETB 5,000'));
  });
}
