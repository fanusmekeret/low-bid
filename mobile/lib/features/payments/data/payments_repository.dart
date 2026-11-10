import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/l10n/app_strings.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/common.dart';

class PaymentsRepository {
  PaymentsRepository(this._api);

  final ApiClient _api;

  Future<PaymentModel> startCheckout(String auctionId) async =>
      PaymentModel.fromJson(asJson((await _api.post('/payments/checkout', data: {'auctionId': auctionId}))['data']));

  /// The server re-checks Chapa when this is called for a pending payment.
  Future<PaymentModel> status(String txRef) async => PaymentModel.fromJson(asJson((await _api.get('/payments/$txRef'))['data']));

  Future<Paged<PaymentModel>> history({int page = 1}) async => Paged.fromResponse(await _api.get('/payments', query: {'page': page}), PaymentModel.fromJson);

  Future<ReceiptModel> receipt(String txRef) async => ReceiptModel.fromJson(asJson((await _api.get('/payments/$txRef/receipt'))['data']));

  Future<void> requestRefund(String txRef, String reason) => _api.post('/payments/$txRef/refund-request', data: {'reason': reason});

  Future<List<BankModel>> banks() async => listOf((await _api.get('/payments/banks'))['data'], BankModel.fromJson);
}

final paymentsRepositoryProvider = Provider<PaymentsRepository>((ref) => PaymentsRepository(ref.watch(apiClientProvider)));

/// Starts a Chapa checkout (the winning bid), opens Chapa's hosted page in an in-app browser,
/// and shows the status screen, which confirms the payment with the server.
Future<void> runCheckout(BuildContext context, WidgetRef ref, Future<PaymentModel> Function(PaymentsRepository) start) async {
  final s = S.of(context);
  final messenger = ScaffoldMessenger.of(context);
  final router = GoRouter.of(context);
  final navigator = Navigator.of(context, rootNavigator: true);
  showDialog<void>(context: context, barrierDismissible: false, builder: (_) => const Center(child: CircularProgressIndicator()));
  PaymentModel payment;
  try {
    payment = await start(ref.read(paymentsRepositoryProvider));
  } on ApiException catch (e) {
    navigator.pop();
    messenger.showSnackBar(SnackBar(content: Text(s.error(e))));
    return;
  }
  navigator.pop();
  if (!context.mounted) return;
  await openCheckout(context, payment, router: router);
}

/// Opens an already-started checkout (e.g. a bid fee) and then the status screen.
Future<void> openCheckout(BuildContext context, PaymentModel payment, {GoRouter? router}) =>
    openCheckoutUrl(context, url: payment.checkoutUrl, txRef: payment.txRef, router: router);

/// Opens Chapa's page for [url] in an in-app browser, then the status screen for [txRef],
/// which confirms the payment with the server (the app never decides a payment succeeded).
Future<void> openCheckoutUrl(BuildContext context, {required String? url, required String txRef, GoRouter? router}) async {
  final s = S.of(context);
  final go = router ?? GoRouter.of(context);
  if (url != null) {
    final opened = await launchUrl(Uri.parse(url), mode: LaunchMode.inAppBrowserView);
    if (!opened) await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  }
  go.push('/payments/$txRef');
  if (url == null && context.mounted) showSnack(context, s.somethingWrong, error: true);
}
