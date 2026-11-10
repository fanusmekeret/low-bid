import 'package:flutter_test/flutter_test.dart';
import 'package:lowbid/shared/widgets/countdown/countdown_logic.dart';

void main() {
  final start = DateTime.utc(2026, 11, 10, 9);
  final end = DateTime.utc(2026, 11, 12, 18);

  group('CountdownState', () {
    test('upcoming before the start', () {
      final s = CountdownState.compute(now: start.subtract(const Duration(hours: 3)), startsAt: start, endsAt: end);
      expect(s.phase, AuctionPhase.upcoming);
      expect(s.remaining, const Duration(hours: 3));
    });

    test('live and normal with plenty of time', () {
      final s = CountdownState.compute(now: start, startsAt: start, endsAt: end);
      expect(s.phase, AuctionPhase.live);
      expect(s.urgency, CountdownUrgency.normal);
    });

    test('amber under 10 minutes', () {
      final s = CountdownState.compute(now: end.subtract(const Duration(minutes: 9)), startsAt: start, endsAt: end);
      expect(s.urgency, CountdownUrgency.soon);
    });

    test('red under 2 minutes', () {
      final s = CountdownState.compute(now: end.subtract(const Duration(seconds: 90)), startsAt: start, endsAt: end);
      expect(s.urgency, CountdownUrgency.critical);
    });

    test('ended at the end time', () {
      expect(CountdownState.compute(now: end, startsAt: start, endsAt: end).phase, AuctionPhase.ended);
    });

    test('ended when the server closed it, even with time left locally', () {
      final s = CountdownState.compute(now: start, startsAt: start, endsAt: end, closed: true);
      expect(s.phase, AuctionPhase.ended);
    });
  });

  group('formatRemaining', () {
    test('days', () => expect(formatRemaining(const Duration(days: 2, hours: 5, minutes: 12, seconds: 30)), '2d 05h 12m'));
    test('days in Amharic', () => expect(formatRemaining(const Duration(days: 2, hours: 5, minutes: 12), languageCode: 'am'), '2 ቀን 05:12'));
    test('hours', () => expect(formatRemaining(const Duration(hours: 5, minutes: 12, seconds: 9)), '05:12:09'));
    test('minutes', () => expect(formatRemaining(const Duration(minutes: 12, seconds: 9)), '12:09'));
    test('rounds up so 0.4 s shows 00:01', () => expect(formatRemaining(const Duration(milliseconds: 400)), '00:01'));
    test('zero', () => expect(formatRemaining(Duration.zero), '00:00'));
    test('negative', () => expect(formatRemaining(const Duration(seconds: -5)), '00:00'));
  });

  test('formatExtension', () => expect(formatExtension(const Duration(minutes: 2)), '+2:00'));
}
