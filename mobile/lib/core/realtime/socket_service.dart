import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../../shared/models/json.dart';
import '../config/env.dart';
import '../network/api_client.dart';
import '../storage/token_storage.dart';
import '../time/server_clock.dart';

/// One event from the server, e.g. name 'auction:bid' with its payload.
class LiveEvent {
  const LiveEvent(this.name, this.data);
  final String name;
  final Json data;

  String? get auctionId => data['auctionId']?.toString();
}

/// Live auction updates over Socket.IO (namespace /live). Read-only: bids go over REST.
/// Rooms are remembered and re-joined after every reconnect.
class SocketService {
  SocketService(this._tokens, this._clock, this._api);

  final TokenStorage _tokens;
  final ServerClock _clock;
  final ApiClient _api;

  static const _eventNames = [
    'auction:bid',
    'auction:started',
    'auction:closed',
    'auction:cancelled',
    'user:won',
    'payment:updated',
  ];

  io.Socket? _socket;
  final _rooms = <String>{};
  final _events = StreamController<LiveEvent>.broadcast();
  bool _refreshingAuth = false;

  Stream<LiveEvent> get events => _events.stream;

  Stream<LiveEvent> forAuction(String auctionId) => events.where((e) => e.auctionId == auctionId);

  void connect() {
    if (_socket != null) return;
    final builder = io.OptionBuilder().setTransports(['websocket']).setPath('/socket.io').enableReconnection().disableAutoConnect();
    final token = _tokens.accessToken;
    if (token != null) builder.setAuth({'token': token});
    final socket = io.io(Env.socketUrl, builder.build());

    socket.onConnect((_) {
      for (final id in _rooms) {
        _emitJoin(socket, id);
      }
    });
    socket.onConnectError((err) => _handleConnectError(err));
    for (final name in _eventNames) {
      socket.on(name, (data) {
        final payload = asJson(data);
        _syncClock(payload);
        _events.add(LiveEvent(name, payload));
      });
    }
    socket.connect();
    _socket = socket;
  }

  /// After sign-in, sign-out or a token refresh: reconnect with the current token.
  void reconnect() {
    _socket?.dispose();
    _socket = null;
    connect();
  }

  void join(String auctionId) {
    _rooms.add(auctionId);
    connect();
    final socket = _socket;
    if (socket != null && socket.connected) _emitJoin(socket, auctionId);
  }

  void leave(String auctionId) {
    _rooms.remove(auctionId);
    _socket?.emit('auction:leave', {'auctionId': auctionId});
  }

  void _emitJoin(io.Socket socket, String auctionId) {
    socket.emitWithAck('auction:join', {'auctionId': auctionId}, ack: (data) => _syncClock(asJson(data)));
  }

  void _syncClock(Json payload) {
    final ms = payload['serverTime'];
    if (ms is int) _clock.sync(DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true));
  }

  Future<void> _handleConnectError(dynamic err) async {
    final text = err?.toString() ?? '';
    if (!text.contains('AUTH_TOKEN') || _refreshingAuth) return;
    _refreshingAuth = true;
    try {
      // Expired access token: refresh it, then reconnect (or continue as a guest).
      await _api.refreshAccessToken();
      reconnect();
    } finally {
      _refreshingAuth = false;
    }
  }

  void dispose() {
    _socket?.dispose();
    _events.close();
  }
}

final socketServiceProvider = Provider<SocketService>((ref) {
  final service = SocketService(ref.watch(tokenStorageProvider), ref.watch(serverClockProvider), ref.watch(apiClientProvider));
  ref.onDispose(service.dispose);
  return service;
});

/// All live events, for screens that react to personal events (outbid, won, payment updated).
final liveEventsProvider = StreamProvider<LiveEvent>((ref) => ref.watch(socketServiceProvider).events);
