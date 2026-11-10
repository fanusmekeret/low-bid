import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/format/formatters.dart';
import '../../../core/l10n/app_strings.dart';
import '../../../core/money/money.dart';
import '../../../core/network/api_exception.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/common.dart';
import '../../catalog/data/catalog_repository.dart';
import '../data/seller_repository.dart';

final _productProvider = FutureProvider.autoDispose.family<ProductModel, String>((ref, id) => ref.watch(sellerRepositoryProvider).product(id));

/// Schedule a lowest-unique-bid auction for an approved listing. The seller sets their price
/// (what they are paid, less commission, whatever the winning bid); LOW BID sets the bid fee
/// and range, and an admin approves it before it goes live.
class AuctionCreateScreen extends ConsumerStatefulWidget {
  const AuctionCreateScreen({super.key, required this.productId});
  final String productId;

  @override
  ConsumerState<AuctionCreateScreen> createState() => _AuctionCreateScreenState();
}

class _AuctionCreateScreenState extends ConsumerState<AuctionCreateScreen> {
  static const _durations = <int>[60, 6 * 60, 12 * 60, 24 * 60, 3 * 24 * 60, 5 * 24 * 60, 7 * 24 * 60];

  final _form = GlobalKey<FormState>();
  final _price = TextEditingController();
  final _value = TextEditingController();
  DateTime _startsAt = _roundUp(DateTime.now().add(const Duration(hours: 2)));
  int _duration = 24 * 60;
  Map<String, String> _errors = const {};
  bool _busy = false;

  static DateTime _roundUp(DateTime t) => DateTime(t.year, t.month, t.day, t.hour, t.minute < 30 ? 30 : 0).add(Duration(hours: t.minute < 30 ? 0 : 1));

  @override
  void dispose() {
    for (final c in [_price, _value]) {
      c.dispose();
    }
    super.dispose();
  }

  /// The bid fee bidders will pay: the category's, or the platform default (shown for information).
  Money? _categoryFee(ProductModel p) {
    final cats = ref.watch(categoriesProvider).valueOrNull ?? const <CategoryModel>[];
    for (final c in cats) {
      for (final leaf in c.leaves) {
        if (leaf.id == p.categoryId && leaf.defaultBidFee > Money.zero) return leaf.defaultBidFee;
      }
    }
    return null;
  }

  Future<void> _pickStart() async {
    final now = DateTime.now();
    final date = await showDatePicker(context: context, initialDate: _startsAt, firstDate: now, lastDate: now.add(const Duration(days: 60)));
    if (date == null || !mounted) return;
    final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(_startsAt));
    if (time == null) return;
    setState(() => _startsAt = DateTime(date.year, date.month, date.day, time.hour, time.minute));
  }

  Future<void> _submit() async {
    final s = S.of(context);
    if (!_form.currentState!.validate()) return;
    String? opt(TextEditingController c) => Money.tryParseEtb(c.text)?.toApiString();
    setState(() {
      _busy = true;
      _errors = const {};
    });
    try {
      await ref.read(sellerRepositoryProvider).createAuction({
        'productId': widget.productId,
        'sellerPrice': opt(_price),
        if (opt(_value) != null) 'marketValue': opt(_value),
        'startsAt': _startsAt.toUtc().toIso8601String(),
        'durationMinutes': _duration,
      });
      ref.invalidate(sellerAuctionsProvider);
      ref.invalidate(sellerProductsProvider);
      if (!mounted) return;
      showSnack(context, s.auctionSubmitted);
      context.pushReplacement('/seller/auctions');
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _errors = e.fieldErrors);
      if (e.fieldErrors.isEmpty) showSnack(context, s.error(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _durationLabel(S s, int minutes) => minutes < 24 * 60 ? s.hours(minutes ~/ 60) : s.days(minutes ~/ (24 * 60));

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final lang = s.lang;
    final product = ref.watch(_productProvider(widget.productId));

    InputDecoration money(String label, {String? hint, String? field}) => InputDecoration(
          labelText: label,
          helperText: hint,
          helperMaxLines: 2,
          prefixText: lang == 'am' ? null : 'ETB ',
          suffixText: lang == 'am' ? 'ብር' : null,
          errorText: field == null ? null : _errors[field],
        );
    final digits = [FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'))];

    String? optionalAmount(String? v) {
      if (v == null || v.trim().isEmpty) return null;
      return Money.tryParseEtb(v) == null ? s.amountInvalid : null;
    }

    return Scaffold(
      appBar: AppBar(title: Text(s.scheduleAuction)),
      body: AsyncValueView<ProductModel>(
        value: product,
        onRetry: () => ref.invalidate(_productProvider(widget.productId)),
        data: (p) {
          final fee = _categoryFee(p);
          return Form(
            key: _form,
            child: ListView(padding: const EdgeInsets.all(16), children: [
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: ClipRRect(borderRadius: BorderRadius.circular(8), child: SizedBox(width: 56, height: 56, child: AppNetworkImage(url: p.images.isEmpty ? null : p.images.first.urls.sm, iconSize: 22))),
                title: Text(p.title, maxLines: 2, overflow: TextOverflow.ellipsis),
                subtitle: p.categoryName == null ? null : Text(p.categoryName!),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _price,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                inputFormatters: digits,
                decoration: money(s.yourPrice, hint: s.yourPriceHint, field: 'sellerPrice'),
                validator: (v) {
                  final m = Money.tryParseEtb(v ?? '');
                  return m == null || m < Money(BigInt.from(10000)) ? s.amountInvalid : null;
                },
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _value,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                inputFormatters: digits,
                decoration: money(s.retailValue, field: 'marketValue'),
                validator: (v) {
                  final err = optionalAmount(v);
                  if (err != null || v == null || v.trim().isEmpty) return err;
                  final price = Money.tryParseEtb(_price.text);
                  return price != null && Money.tryParseEtb(v)! < price ? s.amountInvalid : null;
                },
              ),
              if (fee != null) ...[
                const SizedBox(height: 8),
                Text('${s.bidFee}: ${s.bidFeeEach(fee.format(languageCode: lang))}', style: Theme.of(context).textTheme.bodySmall),
              ],
              const SizedBox(height: 16),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.event),
                title: Text(s.startsAt),
                subtitle: Text(formatDateTime(_startsAt.toUtc(), lang)),
                trailing: const Icon(Icons.edit_calendar_outlined),
                onTap: _pickStart,
              ),
              if (_errors['startsAt'] != null) Text(_errors['startsAt']!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              const SizedBox(height: 8),
              Text(s.duration, style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 8),
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final d in _durations) ChoiceChip(label: Text(_durationLabel(s, d)), selected: _duration == d, onSelected: (_) => setState(() => _duration = d)),
              ]),
              const SizedBox(height: 8),
              Text('→ ${formatDateTime(_startsAt.add(Duration(minutes: _duration)).toUtc(), lang)}', style: Theme.of(context).textTheme.bodySmall),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: _busy ? null : _submit,
                style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50)),
                child: _busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : Text(s.createAuction),
              ),
            ]),
          );
        },
      ),
    );
  }
}
