import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../../core/l10n/app_strings.dart';
import '../../../core/money/money.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_theme.dart';
import '../../catalog/data/catalog_repository.dart';
import '../application/auction_detail_controller.dart';

/// Asks for a secret bid amount and records it. Returns the placed bid (with the checkout for
/// its fee) or null if the sheet was closed. The caller opens the checkout.
Future<PlacedBid?> showBidSheet(BuildContext context, String auctionId) {
  return showModalBottomSheet<PlacedBid>(
    context: context,
    isScrollControlled: true,
    useRootNavigator: true,
    showDragHandle: true,
    builder: (_) => _BidSheet(auctionId: auctionId),
  );
}

class _BidSheet extends ConsumerStatefulWidget {
  const _BidSheet({required this.auctionId});
  final String auctionId;

  @override
  ConsumerState<_BidSheet> createState() => _BidSheetState();
}

class _BidSheetState extends ConsumerState<_BidSheet> {
  final _amount = TextEditingController();
  final _random = Random();
  String? _error;
  bool _busy = false;

  // One key per amount: a retry after a dropped connection reuses it, so the server never
  // records the same bid twice. Changing the amount starts a new key.
  String _key = const Uuid().v4();
  String _keyFor = '';

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  /// A random amount with cents, to help people avoid the popular round numbers.
  void _suggest(AuctionView view) {
    final b = view.detail.bidding;
    final taken = view.myBids.map((x) => x.amount).toSet();
    // Mostly low: the winning amount is usually small.
    final ceiling = b.maxBid.minor < BigInt.from(20000) ? b.maxBid.minor.toInt() : 20000; // up to 200 ETB
    for (var i = 0; i < 20; i++) {
      final raw = b.minBid.minor.toInt() + _random.nextInt(max(1, ceiling - b.minBid.minor.toInt()));
      final step = b.bidStep.minor.toInt();
      final m = Money(BigInt.from(raw - raw % max(1, step)));
      if (m >= b.minBid && !taken.contains(m)) {
        setState(() {
          _amount.text = m.toApiString();
          _error = null;
        });
        return;
      }
    }
  }

  Future<void> _submit() async {
    final s = S.of(context);
    final view = ref.read(auctionDetailProvider(widget.auctionId)).valueOrNull;
    if (view == null) return;
    final amount = Money.tryParseEtb(_amount.text);
    if (amount == null || amount <= Money.zero) {
      setState(() => _error = s.amountInvalid);
      return;
    }
    final problem = view.detail.bidding.check(amount);
    if (problem != null) {
      setState(() => _error = s.error(ApiException(code: problem, message: problem)));
      return;
    }
    if (view.myBids.any((b) => b.amount == amount)) {
      setState(() => _error = s.error(const ApiException(code: 'DUPLICATE_BID_AMOUNT', message: '')));
      return;
    }
    final text = amount.toApiString();
    if (text != _keyFor) {
      _key = const Uuid().v4();
      _keyFor = text;
    }

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final placed = await ref.read(auctionDetailProvider(widget.auctionId).notifier).placeBid(amount, _key);
      if (!mounted) return;
      HapticFeedback.mediumImpact();
      Navigator.of(context).pop(placed);
    } on ApiException catch (e) {
      if (!mounted) return;
      // A server answer (any status) means this key is used up; only a lost connection keeps it.
      if (e.statusCode != null) _keyFor = '';
      setState(() => _error = s.error(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final lang = s.lang;
    final theme = Theme.of(context);
    final view = ref.watch(auctionDetailProvider(widget.auctionId)).valueOrNull;
    if (view == null) return const SizedBox(height: 200);
    final d = view.detail;
    final b = d.bidding;
    final fee = b.bidFee.format(languageCode: lang);

    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(s.placeBid, style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
        const SizedBox(height: 4),
        Text(d.card.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: theme.textTheme.bodyMedium),
        const SizedBox(height: 12),
        Text(s.bidRange(b.minBid.format(languageCode: lang, showCents: true), b.maxBid.format(languageCode: lang)), style: theme.textTheme.bodySmall),
        const SizedBox(height: 12),
        TextField(
          controller: _amount,
          enabled: !_busy,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))],
          style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800, fontFeatures: tabularFigures),
          decoration: InputDecoration(
            labelText: s.yourBid,
            hintText: s.bidAmountHint,
            prefixText: lang == 'am' ? null : 'ETB ',
            suffixText: lang == 'am' ? 'ብር' : null,
            errorText: _error,
            errorMaxLines: 3,
            suffixIcon: IconButton(icon: const Icon(Icons.casino_outlined), onPressed: _busy ? null : () => _suggest(view)),
          ),
          onChanged: (_) => setState(() => _error = null),
          onSubmitted: (_) => _submit(),
        ),
        const SizedBox(height: 12),
        Row(children: [
          const Icon(Icons.lock_outline, size: 16),
          const SizedBox(width: 6),
          Expanded(child: Text(s.bidSecretNote, style: theme.textTheme.bodySmall)),
        ]),
        const SizedBox(height: 20),
        FilledButton(
          onPressed: _busy ? null : _submit,
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
          child: _busy ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5)) : Text(s.payFeeAndBid(fee)),
        ),
      ]),
    );
  }
}
