import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/env.dart';
import '../storage/token_storage.dart';
import '../time/server_clock.dart';
import 'api_exception.dart';
import 'server_time_interceptor.dart';

/// The one HTTP client. Adds the access token, refreshes it once when it expires (other
/// requests wait for that refresh), keeps the server clock in sync, and turns every
/// failure into an ApiException.
class ApiClient {
  ApiClient(this._tokens, ServerClock clock) {
    dio = Dio(BaseOptions(
      baseUrl: Env.apiUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 25),
      headers: {'Accept': 'application/json'},
    ));
    dio.interceptors.add(ServerTimeInterceptor(clock));
    dio.interceptors.add(InterceptorsWrapper(onRequest: _onRequest, onError: _onError));
  }

  final TokenStorage _tokens;
  late final Dio dio;

  /// Called when the session cannot be refreshed (the user must sign in again).
  void Function()? onSessionExpired;

  Future<String?>? _refreshing;

  void _onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final token = _tokens.accessToken;
    if (token != null && options.extra['skipAuth'] != true) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  Future<void> _onError(DioException e, ErrorInterceptorHandler handler) async {
    final code = (e.response?.data is Map && e.response!.data['error'] is Map) ? e.response!.data['error']['code'] : null;
    final isAuthFailure = e.response?.statusCode == 401 && (code == 'AUTH_TOKEN_EXPIRED' || code == 'AUTH_TOKEN_INVALID');
    final alreadyRetried = e.requestOptions.extra['retried'] == true;

    if (isAuthFailure && !alreadyRetried && _tokens.refreshToken != null) {
      final newToken = await refreshAccessToken();
      if (newToken != null) {
        final opts = e.requestOptions
          ..extra['retried'] = true
          ..headers['Authorization'] = 'Bearer $newToken';
        try {
          return handler.resolve(await dio.fetch<dynamic>(opts));
        } on DioException catch (retryError) {
          return handler.next(retryError);
        }
      }
    }
    handler.next(e);
  }

  /// Exchanges the refresh token for new tokens. Concurrent callers share one request.
  Future<String?> refreshAccessToken() {
    return _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);
  }

  Future<String?> _doRefresh() async {
    final refresh = _tokens.refreshToken;
    if (refresh == null) return null;
    try {
      final res = await dio.post<Map<String, dynamic>>(
        '/auth/refresh',
        data: {'refreshToken': refresh},
        options: Options(extra: {'skipAuth': true, 'retried': true}),
      );
      final tokens = res.data!['data']['tokens'] as Map<String, dynamic>;
      await _tokens.save(accessToken: tokens['accessToken'] as String, refreshToken: tokens['refreshToken'] as String?);
      return tokens['accessToken'] as String;
    } on DioException catch (e) {
      // Only a definite rejection ends the session; a network blip keeps it.
      if (e.response?.statusCode == 401 || e.response?.statusCode == 403) {
        await _tokens.clear();
        onSessionExpired?.call();
      }
      return null;
    }
  }

  // ── Small helpers returning the decoded JSON body, throwing ApiException on failure ──

  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) =>
      _wrap(() => dio.get<Map<String, dynamic>>(path, queryParameters: _clean(query)));

  Future<Map<String, dynamic>> post(String path, {Object? data}) =>
      _wrap(() => dio.post<Map<String, dynamic>>(path, data: data));

  Future<Map<String, dynamic>> patch(String path, {Object? data}) =>
      _wrap(() => dio.patch<Map<String, dynamic>>(path, data: data));

  Future<Map<String, dynamic>> put(String path, {Object? data}) =>
      _wrap(() => dio.put<Map<String, dynamic>>(path, data: data));

  Future<Map<String, dynamic>> delete(String path) =>
      _wrap(() => dio.delete<Map<String, dynamic>>(path));

  /// Multipart upload, e.g. product photos.
  Future<Map<String, dynamic>> upload(String path, FormData form, {void Function(int, int)? onProgress}) =>
      _wrap(() => dio.post<Map<String, dynamic>>(path, data: form, onSendProgress: onProgress,
          options: Options(sendTimeout: const Duration(minutes: 3), receiveTimeout: const Duration(minutes: 3))));

  static Map<String, dynamic>? _clean(Map<String, dynamic>? q) =>
      q == null ? null : (Map<String, dynamic>.from(q)..removeWhere((_, v) => v == null || v == ''));

  Future<Map<String, dynamic>> _wrap(Future<Response<Map<String, dynamic>>> Function() call) async {
    try {
      final res = await call();
      return res.data ?? const {};
    } on DioException catch (e) {
      throw ApiException.fromDio(e);
    }
  }
}

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(ref.watch(tokenStorageProvider), ref.watch(serverClockProvider));
});
