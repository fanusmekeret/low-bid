import 'package:flutter/foundation.dart' show kIsWeb;

/// Build-time configuration. Pass values with --dart-define, e.g.
///   flutter run --dart-define=API_BASE_URL=https://api.lowbid.et
///
/// Without API_BASE_URL:
///   • web (flutter run -d chrome): the same host the page is served from, port 4000
///     (http://localhost:4000 in development);
///   • Android emulator: 10.0.2.2:4000, the emulator's address for your computer.
class Env {
  const Env._();

  static const _definedBaseUrl = String.fromEnvironment('API_BASE_URL');

  static String get apiBaseUrl {
    if (_definedBaseUrl.isNotEmpty) return _definedBaseUrl;
    if (kIsWeb) return '${Uri.base.scheme}://${Uri.base.host}:4000';
    return 'http://10.0.2.2:4000';
  }

  static String get apiUrl => '$apiBaseUrl/api/v1';
  static String get socketUrl => '$apiBaseUrl/live';

  /// The app link the payment return page opens (must match the backend's APP_DEEP_LINK).
  static const paymentDeepLinkScheme = 'lowbid';
}
