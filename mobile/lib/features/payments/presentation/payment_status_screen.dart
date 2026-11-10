import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/l10n/app_strings.dart';
import '../../../core/realtime/socket_service.dart';
import '../../../core/theme/app_theme.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/common.dart';
import '../../catalog/data/catalog_repository.dart';
import '../data/payments_repository.dart';

/// Shown after Chapa checkout (and when the app opens from the lowbid://payments link).
/// The app never decides a payment succeeded: it asks the server, which verifies with
/// Chapa, every few seconds until the payment is settled either way.
class PaymentStatusScreen extends ConsumerStatefulWidget {
  const PaymentStatusScreen({super.key, required this.txRef});
  final String txRef;

  @override
  ConsumerState<PaymentStatusScreen> createState() => _PaymentStatusScreenState();
}

class _PaymentStatusScreenState extends ConsumerState<PaymentStatusScreen> {
  static const _pollEvery = Duration(seconds: 3);
  static const _slowAfter = Duration(minutes: 2);

  PaymentModel? _payment;
  Object? _error;
  Timer? _timer;
  StreamSubscription<LiveEvent>? _sub;
  final _started = DateTime.now();
  bool _checking = false;

  @override
  void initState() {
    super.initState();
    _sub = ref.read(socketServiceProvider).events.where((e) => e.name == 'payment:updated' && e.data['txRef']?.toString() == widget.txRef).listen((_) => _check());
    _check();
  }

  @override
  void dispose() {
    _timer?.cancel();
    _sub?.cancel();
    super.dispose();
  }

  Future<void> _check() async {
    if (_checking) return;
    _checking = true;
    _timer?.cancel();
    try {
      final p = await ref.read(paymentsRepositoryProvider).status(widget.txRef);
      if (!mounted) return;
      setState(() {
        _payment = p;
        _error = null;
      });
      if (!p.isPending) {
        // Lists that show this payment are now out of date.
        ref.invalidate(wonProvider);
        ref.invalidate(homeProvider);
        return;
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      _checking = false;
    }
    if (!mounted) return;
    // Poll quickly at first, then back off once it is clearly slow.
    final slow = DateTime.now().difference(_started) > _slowAfter;
    _timer = Timer(slow ? const Duration(seconds: 15) : _pollEvery, _check);
  }

  Future<void> _reopenCheckout() async {
    final url = _payment?.checkoutUrl;
    if (url == null) return;
    final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.inAppBrowserView);
    if (!ok) await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    _check();
  }

  void _done() {
    final router = GoRouter.of(context);
    final auctionId = _payment?.auctionId;
    router.go('/home');
    if (auctionId != null) router.push('/auctions/$auctionId');
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final p = _payment;
    final lang = s.lang;

    late final IconData icon;
    late final Color color;
    late final String title;
    var body = '';
    final actions = <Widget>[];

    if (p == null) {
      if (_error != null) {
        return Scaffold(appBar: AppBar(), body: ErrorState(message: s.error(_error!), onRetry: _check));
      }
      return Scaffold(appBar: AppBar(), body: const Center(child: CircularProgressIndicator()));
    }

    if (p.isPaid) {
      icon = Icons.check_circle;
      color = AppColors.green;
      title = s.paymentConfirmed;
      body = '${s.purpose(p.purpose)} · ${p.amount.format(languageCode: lang)}';
      if (p.status != 'PAID') body = '$body\n${s.paymentStatus(p.status)}';
      if (p.receiptNo != null) actions.add(OutlinedButton.icon(onPressed: () => context.push('/payments/${p.txRef}/receipt'), icon: const Icon(Icons.receipt_long_outlined), label: Text(s.viewReceipt)));
      actions.add(FilledButton(onPressed: _done, child: Text(s.done)));
    } else if (p.isPending) {
      icon = Icons.hourglass_top;
      color = AppColors.teal;
      title = s.confirmingPayment;
      body = s.confirmingPaymentBody;
      if (p.checkoutUrl != null) actions.add(OutlinedButton.icon(onPressed: _reopenCheckout, icon: const Icon(Icons.open_in_new), label: Text(s.openCheckout)));
      actions.add(TextButton(onPressed: _done, child: Text(s.close)));
    } else {
      icon = p.status == 'EXPIRED' ? Icons.timer_off_outlined : Icons.error_outline;
      color = AppColors.red;
      title = p.status == 'EXPIRED' ? s.paymentExpired : s.paymentFailed;
      body = s.paymentStatus(p.status);
      actions.add(FilledButton(onPressed: _done, child: Text(s.close)));
    }

    return Scaffold(
      appBar: AppBar(title: Text(s.purpose(p.purpose))),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const Spacer(),
            if (p.isPending)
              const Center(child: SizedBox(width: 64, height: 64, child: CircularProgressIndicator(strokeWidth: 5)))
            else
              Icon(icon, size: 80, color: color),
            const SizedBox(height: 24),
            Text(title, textAlign: TextAlign.center, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 12),
            Text(body, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            Text('${s.reference}: ${p.txRef}', textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodySmall),
            const Spacer(),
            for (final a in actions) Padding(padding: const EdgeInsets.only(top: 8), child: a),
          ]),
        ),
      ),
    );
  }
}
