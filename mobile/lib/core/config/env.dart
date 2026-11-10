/// Build-time configuration. Pass values with --dart-define, e.g.
///   flutter run --dart-define=API_BASE_URL=https://api.lowbid.et
///
/// Default: the Android emulator's address for a backend on your computer.
class Env {
  const Env._();

  static const apiBaseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'http://10.0.2.2:4000');

  static String get apiUrl => '$apiBaseUrl/api/v1';
  static String get socketUrl => '$apiBaseUrl/live';

  /// The app link the payment return page opens (must match the backend's APP_DEEP_LINK).
  static const paymentDeepLinkScheme = 'lowbid';
}
