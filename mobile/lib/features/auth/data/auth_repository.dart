import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/storage/token_storage.dart';
import '../../../shared/models/models.dart';

class OtpInfo {
  const OtpInfo({required this.to, required this.resendAfterSeconds, this.sent = true});
  final String to;
  final int resendAfterSeconds;
  final bool sent;

  factory OtpInfo.fromJson(Json j) => OtpInfo(to: str(j['to']), resendAfterSeconds: toInt(j['resendAfterSeconds'], 60), sent: j['sent'] != false);
}

class AuthRepository {
  AuthRepository(this._api, this._tokens);

  final ApiClient _api;
  final TokenStorage _tokens;

  Future<UserModel> _saveSession(Json data) async {
    final tokens = asJson(data['tokens']);
    await _tokens.save(accessToken: str(tokens['accessToken']), refreshToken: strOrNull(tokens['refreshToken']));
    return UserModel.fromJson(asJson(data['user']));
  }

  Future<UserModel> login(String phone, String password) async {
    final body = await _api.post('/auth/login', data: {'phone': phone, 'password': password});
    return _saveSession(asJson(body['data']));
  }

  Future<(UserModel, OtpInfo)> register({
    required String phone,
    required String password,
    required String firstName,
    required String lastName,
    String? email,
    required String locale,
  }) async {
    final body = await _api.post('/auth/register', data: {
      'phone': phone,
      'password': password,
      'firstName': firstName,
      'lastName': lastName,
      if (email != null && email.isNotEmpty) 'email': email,
      'locale': locale,
    });
    final data = asJson(body['data']);
    return (await _saveSession(data), OtpInfo.fromJson(asJson(data['otp'])));
  }

  Future<OtpInfo> sendOtp() async => OtpInfo.fromJson(asJson((await _api.post('/auth/otp/send'))['data']));

  /// Verifying the phone grants the bidder role; the new access token carries it.
  Future<UserModel> verifyOtp(String code) async {
    final data = asJson((await _api.post('/auth/otp/verify', data: {'code': code}))['data']);
    return _saveSession(data);
  }

  Future<void> forgotPassword(String phone) => _api.post('/auth/password/forgot', data: {'phone': phone});

  Future<void> resetPassword({required String phone, required String code, required String newPassword}) =>
      _api.post('/auth/password/reset', data: {'phone': phone, 'code': code, 'newPassword': newPassword});

  Future<UserModel> me() async => UserModel.fromJson(asJson((await _api.get('/me'))['data']));

  Future<UserModel> updateMe(Json fields) async => UserModel.fromJson(asJson((await _api.patch('/me', data: fields))['data']));

  Future<void> logout() async {
    final refresh = _tokens.refreshToken;
    try {
      if (refresh != null) await _api.post('/auth/logout', data: {'refreshToken': refresh});
    } catch (_) {
      // Signing out locally always succeeds, even offline.
    }
    await _tokens.clear();
  }
}

final authRepositoryProvider = Provider<AuthRepository>((ref) => AuthRepository(ref.watch(apiClientProvider), ref.watch(tokenStorageProvider)));
