import 'package:dio/dio.dart';

import '../time/server_clock.dart';

/// Reads `X-Server-Time` (epoch ms) from every API response and keeps ServerClock in sync.
/// Add it to the app's Dio instance: `dio.interceptors.add(ServerTimeInterceptor(clock))`.
class ServerTimeInterceptor extends Interceptor {
  ServerTimeInterceptor(this._clock);

  final ServerClock _clock;
  static const _sentAtKey = 'lowbid.sentAt';

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    options.extra[_sentAtKey] = DateTime.now();
    handler.next(options);
  }

  @override
  void onResponse(Response<dynamic> response, ResponseInterceptorHandler handler) {
    _read(response);
    handler.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    // Error responses carry the header too, so a failed first call still syncs the clock.
    final response = err.response;
    if (response != null) _read(response);
    handler.next(err);
  }

  void _read(Response<dynamic> response) {
    final raw = response.headers.value('x-server-time');
    final ms = raw == null ? null : int.tryParse(raw);
    if (ms == null) return;
    _clock.sync(
      DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true),
      requestSentAt: response.requestOptions.extra[_sentAtKey] as DateTime?,
    );
  }
}
