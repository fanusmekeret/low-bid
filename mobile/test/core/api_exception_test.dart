import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lowbid/core/network/api_exception.dart';

DioException _response(int status, Object data) {
  final req = RequestOptions(path: '/x');
  return DioException(requestOptions: req, response: Response(requestOptions: req, statusCode: status, data: data), type: DioExceptionType.badResponse);
}

void main() {
  test('reads the server error envelope', () {
    final e = ApiException.fromDio(_response(409, {
      'error': {'code': 'BID_TOO_LOW', 'message': 'Raise your bid', 'details': {'nextMinimumBid': {'minor': '500000'}}},
    }));
    expect(e.code, 'BID_TOO_LOW');
    expect(e.statusCode, 409);
    expect(e.detailMap['nextMinimumBid'], {'minor': '500000'});
  });

  test('maps validation details to field errors', () {
    final e = ApiException.fromDio(_response(400, {
      'error': {
        'code': 'VALIDATION_FAILED',
        'message': 'Invalid',
        'details': [
          {'path': 'phone', 'message': 'Enter a valid phone'},
          {'path': 'password', 'message': 'Too short'},
        ],
      },
    }));
    expect(e.fieldErrors, {'phone': 'Enter a valid phone', 'password': 'Too short'});
  });

  test('connection problems have no status (safe to retry with the same key)', () {
    final e = ApiException.fromDio(DioException(requestOptions: RequestOptions(path: '/x'), type: DioExceptionType.connectionError));
    expect(e.code, ApiException.network);
    expect(e.statusCode, isNull);
  });

  test('non-JSON errors become UNKNOWN_ERROR with the status', () {
    final e = ApiException.fromDio(_response(502, '<html>Bad gateway</html>'));
    expect(e.code, ApiException.unknown);
    expect(e.statusCode, 502);
  });
}
