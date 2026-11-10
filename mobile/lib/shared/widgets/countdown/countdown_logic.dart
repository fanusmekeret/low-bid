/// Pure countdown rules, kept free of Flutter so they are easy to unit test.
library;

enum AuctionPhase { upcoming, live, ended }

enum CountdownUrgency { normal, soon, critical }

/// Under this much time left the timer turns amber.
const kSoonThreshold = Duration(minutes: 10);

/// Under this much time left the timer turns red and pulses.
const kCriticalThreshold = Duration(minutes: 2);

class CountdownState {
  const CountdownState({required this.phase, required this.remaining, required this.urgency});

  /// [closed] is true when the server has already closed the auction (it may close
  /// a moment before or after the local tick reaches zero; the server wins).
  factory CountdownState.compute({
    required DateTime now,
    required DateTime startsAt,
    required DateTime endsAt,
    bool closed = false,
  }) {
    if (closed || !now.isBefore(endsAt)) {
      return const CountdownState(phase: AuctionPhase.ended, remaining: Duration.zero, urgency: CountdownUrgency.normal);
    }
    if (now.isBefore(startsAt)) {
      return CountdownState(phase: AuctionPhase.upcoming, remaining: startsAt.difference(now), urgency: CountdownUrgency.normal);
    }
    final left = endsAt.difference(now);
    final urgency = left <= kCriticalThreshold
        ? CountdownUrgency.critical
        : left <= kSoonThreshold
            ? CountdownUrgency.soon
            : CountdownUrgency.normal;
    return CountdownState(phase: AuctionPhase.live, remaining: left, urgency: urgency);
  }

  final AuctionPhase phase;
  final Duration remaining;
  final CountdownUrgency urgency;
}

String _two(int n) => n.toString().padLeft(2, '0');

/// Over 24 h: `2d 05h 12m` · under 24 h: `05:12:09` · under 1 h: `12:09`.
/// Rounds up to the whole second so it never shows 00:00 while time is left.
/// Amharic uses ቀን for days; digits stay Western so they match prices.
String formatRemaining(Duration d, {String languageCode = 'en'}) {
  if (d <= Duration.zero) return '00:00';
  final total = (d.inMilliseconds + 999) ~/ 1000;
  final days = total ~/ 86400;
  final hours = (total % 86400) ~/ 3600;
  final minutes = (total % 3600) ~/ 60;
  final seconds = total % 60;

  if (days > 0) {
    return languageCode == 'am'
        ? '$days ቀን ${_two(hours)}:${_two(minutes)}'
        : '${days}d ${_two(hours)}h ${_two(minutes)}m';
  }
  if (hours > 0) return '${_two(hours)}:${_two(minutes)}:${_two(seconds)}';
  return '${_two(minutes)}:${_two(seconds)}';
}

/// `+2:00` for an anti-sniping extension.
String formatExtension(Duration d) {
  final s = d.inSeconds;
  return '+${s ~/ 60}:${_two(s % 60)}';
}

class CountdownLabels {
  const CountdownLabels({required this.endsIn, required this.startsIn, required this.ended, required this.extended});

  // Amharic wording: have a native speaker review before launch.
  static const en = CountdownLabels(endsIn: 'Ends in', startsIn: 'Starts in', ended: 'Ended', extended: 'extended');
  static const am = CountdownLabels(endsIn: 'የሚያበቃው በ', startsIn: 'የሚጀምረው በ', ended: 'አብቅቷል', extended: 'ተራዝሟል');

  static CountdownLabels of(String languageCode) => languageCode == 'am' ? am : en;

  final String endsIn;
  final String startsIn;
  final String ended;
  final String extended;
}
