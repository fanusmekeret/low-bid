import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Keeps the session tokens in the Keychain (iOS) / EncryptedSharedPreferences (Android).
class TokenStorage {
  TokenStorage([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(aOptions: AndroidOptions(encryptedSharedPreferences: true));

  final FlutterSecureStorage _storage;
  static const _accessKey = 'lowbid.access';
  static const _refreshKey = 'lowbid.refresh';

  String? _access;
  String? _refresh;
  bool _loaded = false;

  Future<void> load() async {
    if (_loaded) return;
    _access = await _storage.read(key: _accessKey);
    _refresh = await _storage.read(key: _refreshKey);
    _loaded = true;
  }

  String? get accessToken => _access;
  String? get refreshToken => _refresh;
  bool get hasSession => _refresh != null;

  Future<void> save({required String accessToken, String? refreshToken}) async {
    _access = accessToken;
    await _storage.write(key: _accessKey, value: accessToken);
    if (refreshToken != null) {
      _refresh = refreshToken;
      await _storage.write(key: _refreshKey, value: refreshToken);
    }
  }

  Future<void> clear() async {
    _access = null;
    _refresh = null;
    await _storage.delete(key: _accessKey);
    await _storage.delete(key: _refreshKey);
  }
}

final tokenStorageProvider = Provider<TokenStorage>((ref) => TokenStorage());
