import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/realtime/socket_service.dart';
import '../../../core/storage/token_storage.dart';
import '../../../shared/models/models.dart';
import '../data/auth_repository.dart';

/// The signed-in user, or null for a guest. Loading while the saved session is restored.
class AuthController extends AsyncNotifier<UserModel?> {
  AuthRepository get _repo => ref.read(authRepositoryProvider);

  @override
  Future<UserModel?> build() async {
    final tokens = ref.read(tokenStorageProvider);
    await tokens.load();
    ref.read(apiClientProvider).onSessionExpired = () {
      state = const AsyncData(null);
      ref.read(socketServiceProvider).reconnect();
    };
    if (!tokens.hasSession) return null;
    try {
      return await _repo.me();
    } on ApiException catch (e) {
      if (e.statusCode == 401 || e.statusCode == 403) {
        await tokens.clear();
        return null;
      }
      rethrow; // offline at launch: the splash screen offers a retry
    }
  }

  void _signedIn(UserModel user) {
    state = AsyncData(user);
    ref.read(socketServiceProvider).reconnect();
  }

  Future<void> login(String phone, String password) async => _signedIn(await _repo.login(phone, password));

  Future<OtpInfo> register({
    required String phone,
    required String password,
    required String firstName,
    required String lastName,
    String? email,
    required String locale,
  }) async {
    final (user, otp) = await _repo.register(phone: phone, password: password, firstName: firstName, lastName: lastName, email: email, locale: locale);
    _signedIn(user);
    return otp;
  }

  Future<void> verifyOtp(String code) async => _signedIn(await _repo.verifyOtp(code));

  Future<void> refreshUser() async {
    final user = await _repo.me();
    state = AsyncData(user);
  }

  void setUser(UserModel user) => state = AsyncData(user);

  Future<void> logout() async {
    await _repo.logout();
    state = const AsyncData(null);
    ref.read(socketServiceProvider).reconnect();
  }
}

final authControllerProvider = AsyncNotifierProvider<AuthController, UserModel?>(AuthController.new);

/// The current user or null (guest, or still loading).
final currentUserProvider = Provider<UserModel?>((ref) => ref.watch(authControllerProvider).valueOrNull);
