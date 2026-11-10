import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/app_strings.dart';
import '../../../core/network/api_exception.dart';
import '../../../shared/widgets/common.dart';
import '../application/auth_controller.dart';
import '../data/auth_repository.dart';

/// Phone verification. Verifying unlocks bidding (the bidder role).
class OtpScreen extends ConsumerStatefulWidget {
  const OtpScreen({super.key, this.from});

  final String? from;

  @override
  ConsumerState<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends ConsumerState<OtpScreen> {
  final _code = TextEditingController();
  bool _busy = false;
  String? _error;
  int _resendIn = 60;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _startTimer(60);
  }

  @override
  void dispose() {
    _timer?.cancel();
    _code.dispose();
    super.dispose();
  }

  void _startTimer(int seconds) {
    _timer?.cancel();
    setState(() => _resendIn = seconds);
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return t.cancel();
      setState(() => _resendIn = (_resendIn - 1).clamp(0, 999));
      if (_resendIn == 0) t.cancel();
    });
  }

  Future<void> _verify() async {
    if (_code.text.length != 6) return;
    setState(() { _busy = true; _error = null; });
    try {
      await ref.read(authControllerProvider.notifier).verifyOtp(_code.text);
      if (mounted) context.go(widget.from ?? '/home');
    } on ApiException catch (e) {
      if (e.code == 'PHONE_ALREADY_VERIFIED') {
        await ref.read(authControllerProvider.notifier).refreshUser();
        if (mounted) context.go(widget.from ?? '/home');
        return;
      }
      if (mounted) setState(() => _error = S.of(context).error(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resend() async {
    try {
      final info = await ref.read(authRepositoryProvider).sendOtp();
      _startTimer(info.resendAfterSeconds);
    } on ApiException catch (e) {
      final wait = e.detailMap['retryAfterSeconds'];
      if (wait is int) _startTimer(wait);
      if (mounted) showSnack(context, S.of(context).error(e), error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final user = ref.watch(currentUserProvider);
    return Scaffold(
      appBar: AppBar(actions: [TextButton(onPressed: () => context.go(widget.from ?? '/home'), child: Text(s.verifyLater))]),
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.all(24), children: [
          Text(s.verifyPhone, style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 8),
          Text(s.codeSentTo(user?.phone ?? ''), style: Theme.of(context).textTheme.bodyLarge),
          const SizedBox(height: 24),
          TextField(
            controller: _code,
            autofocus: true,
            keyboardType: TextInputType.number,
            autofillHints: const [AutofillHints.oneTimeCode],
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 28, letterSpacing: 12, fontWeight: FontWeight.w700),
            inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
            decoration: InputDecoration(hintText: '••••••', errorText: _error),
            onChanged: (v) {
              if (v.length == 6) _verify();
            },
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _busy ? null : _verify,
            child: _busy ? const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2.5)) : Text(s.verify),
          ),
          const SizedBox(height: 12),
          Center(
            child: _resendIn > 0
                ? Text(s.resendIn(_resendIn), style: Theme.of(context).textTheme.bodyMedium)
                : TextButton(onPressed: _resend, child: Text(s.resendCode)),
          ),
        ]),
      ),
    );
  }
}

/// Sends a fresh code, then opens the code screen. Used by "Verify now" and "Verify to bid".
/// OTP_COOLDOWN means a code was sent moments ago, so the screen opens anyway.
Future<void> startPhoneVerification(BuildContext context, WidgetRef ref, {String? from}) async {
  final s = S.of(context);
  final router = GoRouter.of(context);
  try {
    await ref.read(authRepositoryProvider).sendOtp();
  } on ApiException catch (e) {
    if (e.code != 'OTP_COOLDOWN') {
      if (context.mounted) showSnack(context, s.error(e), error: true);
      return;
    }
  }
  router.push(Uri(path: '/otp', queryParameters: {if (from != null) 'from': from}).toString());
}
