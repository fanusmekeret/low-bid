import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Server-synchronised clock. Countdowns never use the phone's own clock directly:
/// a phone set 5 minutes fast would otherwise show auctions ending early.
///
/// The offset is learned from the `X-Server-Time` header on every API response
/// (see ServerTimeInterceptor) and from `serverTime` in Socket.IO auction events.
class ServerClock {
  Duration _offset = Duration.zero;
  bool _synced = false;

  Duration get offset => _offset;
  bool get isSynced => _synced;

  /// Current server time, UTC.
  DateTime now() => DateTime.now().toUtc().add(_offset);

  /// Feed one server timestamp. [requestSentAt] lets us correct for half the round trip.
  void sync(DateTime serverTime, {DateTime? requestSentAt, DateTime? receivedAt}) {
    final received = (receivedAt ?? DateTime.now()).toUtc();
    final halfTrip = requestSentAt == null
        ? Duration.zero
        : received.difference(requestSentAt.toUtc()) ~/ 2;
    final sample = serverTime.toUtc().add(halfTrip).difference(received);

    // Jump on the first sample or a big correction; otherwise smooth out network jitter
    // so timers on screen never stutter backwards by a second.
    if (!_synced || (sample - _offset).abs() > const Duration(seconds: 2)) {
      _offset = sample;
    } else {
      _offset = Duration(microseconds: (_offset.inMicroseconds * 3 + sample.inMicroseconds) ~/ 4);
    }
    _synced = true;
  }
}

final serverClockProvider = Provider<ServerClock>((ref) => ServerClock());

/// One app-wide tick per second, aligned to the start of each second, so every
/// countdown on screen changes at the same moment and only one timer runs.
final serverNowProvider = StreamProvider<DateTime>((ref) async* {
  final clock = ref.watch(serverClockProvider);
  yield clock.now();
  await for (final _ in _wholeSecondTicks()) {
    yield clock.now();
  }
});

Stream<void> _wholeSecondTicks() async* {
  while (true) {
    final msToNextSecond = 1000 - DateTime.now().millisecond;
    await Future<void>.delayed(Duration(milliseconds: msToNextSecond));
    yield null;
  }
}
