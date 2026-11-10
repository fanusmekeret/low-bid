import 'dart:async';
import 'dart:ui' show FontFeature;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/time/server_clock.dart';
import 'countdown_logic.dart';

/// How the countdown is drawn.
/// - [chip]: pill over an auction card photo (home, category, search, watchlist, my bids).
/// - [banner]: large timer pinned at the top of the auction detail screen.
/// - [inline]: one line of text, e.g. inside the place-bid sheet.
enum CountdownSize { chip, banner, inline }

/// Live auction countdown driven by server time.
///
/// Rebuilds once per second from [serverNowProvider]. When a late bid extends the
/// auction (endsAt moves later), it flashes "+2:00 extended" for a few seconds.
class AuctionCountdown extends ConsumerStatefulWidget {
  const AuctionCountdown({
    super.key,
    required this.startsAt,
    required this.endsAt,
    this.closed = false,
    this.size = CountdownSize.chip,
    this.onEnded,
  });

  final DateTime startsAt;
  final DateTime endsAt;

  /// True once the server reports the auction closed.
  final bool closed;
  final CountdownSize size;

  /// Called once when the timer reaches zero (e.g. to refresh the auction from the API).
  final VoidCallback? onEnded;

  @override
  ConsumerState<AuctionCountdown> createState() => _AuctionCountdownState();
}

class _AuctionCountdownState extends ConsumerState<AuctionCountdown> with SingleTickerProviderStateMixin {
  late final AnimationController _pulse =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 700), lowerBound: 0, upperBound: 1);
  Duration? _extension;
  Timer? _extensionTimer;
  bool _endedReported = false;

  @override
  void didUpdateWidget(covariant AuctionCountdown old) {
    super.didUpdateWidget(old);
    if (widget.endsAt.isAfter(old.endsAt) && !old.endsAt.isAtSameMomentAs(widget.endsAt)) {
      setState(() => _extension = widget.endsAt.difference(old.endsAt));
      _extensionTimer?.cancel();
      _extensionTimer = Timer(const Duration(seconds: 4), () {
        if (mounted) setState(() => _extension = null);
      });
      _endedReported = false;
    }
  }

  @override
  void dispose() {
    _extensionTimer?.cancel();
    _pulse.dispose();
    super.dispose();
  }

  void _syncPulse(bool critical) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (critical && !_pulse.isAnimating) {
        _pulse.repeat(reverse: true);
      } else if (!critical && _pulse.isAnimating) {
        _pulse
          ..stop()
          ..value = 0;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final now = ref.watch(serverNowProvider).value ?? ref.read(serverClockProvider).now();
    final state = CountdownState.compute(
      now: now,
      startsAt: widget.startsAt.toUtc(),
      endsAt: widget.endsAt.toUtc(),
      closed: widget.closed,
    );

    if (state.phase == AuctionPhase.ended && !_endedReported) {
      _endedReported = true;
      if (widget.onEnded != null) WidgetsBinding.instance.addPostFrameCallback((_) => widget.onEnded!());
    }
    _syncPulse(state.urgency == CountdownUrgency.critical);

    final lang = Localizations.localeOf(context).languageCode;
    final labels = CountdownLabels.of(lang);
    final colors = _CountdownColors.resolve(Theme.of(context).brightness, state, onPhoto: widget.size == CountdownSize.chip);
    final label = switch (state.phase) {
      AuctionPhase.upcoming => labels.startsIn,
      AuctionPhase.live => labels.endsIn,
      AuctionPhase.ended => labels.ended,
    };
    final time = state.phase == AuctionPhase.ended ? '' : formatRemaining(state.remaining, languageCode: lang);

    final child = switch (widget.size) {
      CountdownSize.chip => _Chip(label: label, time: time, colors: colors),
      CountdownSize.banner => _Banner(label: label, time: time, colors: colors, extension: _extension, labels: labels),
      CountdownSize.inline => _Inline(label: label, time: time, colors: colors),
    };

    // Screen readers get one label; no live region, so it is not read out every second.
    return Semantics(
      label: time.isEmpty ? label : '$label $time',
      excludeSemantics: true,
      child: AnimatedBuilder(
        animation: _pulse,
        builder: (context, child) => Opacity(opacity: 1 - _pulse.value * 0.35, child: child),
        child: child,
      ),
    );
  }
}

const _tabular = [FontFeature.tabularFigures()];

class _CountdownColors {
  const _CountdownColors({required this.background, required this.foreground, required this.ink});

  final Color background;
  final Color foreground;

  /// Text colour for the digits when drawn on a plain surface (inline style).
  final Color ink;

  // LOW BID palette
  static const _teal = Color(0xFF0F4C5C);
  static const _tealLight = Color(0xFF7CC4D4);
  static const _amber = Color(0xFFF2A541);
  static const _amberInk = Color(0xFF5C3A00);
  static const _amberText = Color(0xFFB36B00);
  static const _red = Color(0xFFD03B3B);
  static const _ended = Color(0xFF6B7280);

  static _CountdownColors resolve(Brightness brightness, CountdownState s, {required bool onPhoto}) {
    final dark = brightness == Brightness.dark;
    if (s.phase == AuctionPhase.ended) {
      return _CountdownColors(background: _ended.withValues(alpha: onPhoto ? 0.85 : 0.14), foreground: onPhoto ? Colors.white : _ended, ink: _ended);
    }
    switch (s.urgency) {
      case CountdownUrgency.critical:
        return const _CountdownColors(background: _red, foreground: Colors.white, ink: _red);
      case CountdownUrgency.soon:
        return const _CountdownColors(background: _amber, foreground: _amberInk, ink: _amberText);
      case CountdownUrgency.normal:
        if (onPhoto) {
          // Dark glass pill stays readable on any product photo.
          return _CountdownColors(background: Colors.black.withValues(alpha: 0.62), foreground: Colors.white, ink: dark ? _tealLight : _teal);
        }
        final teal = dark ? _tealLight : _teal;
        return _CountdownColors(background: teal.withValues(alpha: dark ? 0.18 : 0.10), foreground: teal, ink: teal);
    }
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.time, required this.colors});

  final String label;
  final String time;
  final _CountdownColors colors;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(color: colors.background, borderRadius: BorderRadius.circular(999)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.timer_outlined, size: 14, color: colors.foreground),
        const SizedBox(width: 5),
        Text(
          time.isEmpty ? label : '$label $time',
          style: text.labelMedium?.copyWith(color: colors.foreground, fontWeight: FontWeight.w600, fontFeatures: _tabular),
        ),
      ]),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.label, required this.time, required this.colors, required this.extension, required this.labels});

  final String label;
  final String time;
  final _CountdownColors colors;
  final Duration? extension;
  final CountdownLabels labels;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 250),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(color: colors.background, borderRadius: BorderRadius.circular(16)),
      child: Row(children: [
        Icon(Icons.timer_outlined, size: 28, color: colors.foreground),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Text(label, style: text.labelLarge?.copyWith(color: colors.foreground, fontWeight: FontWeight.w500)),
            if (time.isNotEmpty)
              Text(
                time,
                style: text.headlineMedium?.copyWith(
                  color: colors.foreground,
                  fontWeight: FontWeight.w700,
                  fontFeatures: _tabular,
                  height: 1.1,
                ),
              ),
          ]),
        ),
        AnimatedSwitcher(
          duration: const Duration(milliseconds: 300),
          transitionBuilder: (child, anim) => ScaleTransition(scale: anim, child: child),
          child: extension == null
              ? const SizedBox.shrink()
              : Container(
                  key: ValueKey(extension),
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(color: colors.foreground, borderRadius: BorderRadius.circular(999)),
                  child: Text(
                    '${formatExtension(extension!)} ${labels.extended}',
                    style: text.labelMedium?.copyWith(color: colors.background.withValues(alpha: 1), fontWeight: FontWeight.w700, fontFeatures: _tabular),
                  ),
                ),
        ),
      ]),
    );
  }
}

class _Inline extends StatelessWidget {
  const _Inline({required this.label, required this.time, required this.colors});

  final String label;
  final String time;
  final _CountdownColors colors;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.bodyMedium;
    return Text.rich(TextSpan(children: [
      TextSpan(text: time.isEmpty ? label : '$label ', style: style?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant)),
      if (time.isNotEmpty)
        TextSpan(text: time, style: style?.copyWith(color: colors.ink, fontWeight: FontWeight.w700, fontFeatures: _tabular)),
    ]));
  }
}
