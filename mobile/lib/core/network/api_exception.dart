import 'package:dio/dio.dart';

/// Every API failure becomes one of these. `code` is the stable server code
/// (e.g. BID_TOO_LOW); screens translate it with AppStrings.error(code).
class ApiException implements Exception {
  const ApiException({required this.code, required this.message, this.statusCode, this.details});

  final String code;
  final String message;
  final int? statusCode;
  final Object? details;

  static const network = 'NETWORK_ERROR';
  static const timeout = 'TIMEOUT';
  static const unknown = 'UNKNOWN_ERROR';

  /// Field errors from VALIDATION_FAILED: { "phone": "Enter a valid…" }.
  Map<String, String> get fieldErrors {
    final d = details;
    if (code != 'VALIDATION_FAILED' || d is! List) return const {};
    return {
      for (final e in d)
        if (e is Map && e['path'] != null) e['path'].toString(): (e['message'] ?? '').toString(),
    };
  }

  Map<String, dynamic> get detailMap => details is Map ? Map<String, dynamic>.from(details as Map) : const {};

  factory ApiException.fromDio(DioException e) {
    if (e.error is ApiException) return e.error as ApiException;
    switch (e.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return const ApiException(code: timeout, message: 'The connection timed out');
      case DioExceptionType.connectionError:
        return const ApiException(code: network, message: 'No connection');
      default:
        break;
    }
    final res = e.response;
    final data = res?.data;
    if (data is Map && data['error'] is Map) {
      final err = data['error'] as Map;
      return ApiException(
        code: (err['code'] ?? unknown).toString(),
        message: (err['message'] ?? 'Something went wrong').toString(),
        statusCode: res?.statusCode,
        details: err['details'],
      );
    }
    return ApiException(code: unknown, message: 'Something went wrong', statusCode: res?.statusCode);
  }

  @override
  String toString() => 'ApiException($code, $message)';
}
