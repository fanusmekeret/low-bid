import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/format/formatters.dart';
import '../../../core/l10n/app_strings.dart';
import '../../../core/theme/app_theme.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/common.dart';
import '../../../shared/widgets/logo.dart';
import '../data/payments_repository.dart';

final receiptProvider = FutureProvider.autoDispose.family<ReceiptModel, String>((ref, txRef) => ref.watch(paymentsRepositoryProvider).receipt(txRef));

class ReceiptScreen extends ConsumerWidget {
  const ReceiptScreen({super.key, required this.txRef});
  final String txRef;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(s.receipt)),
      body: AsyncValueView<ReceiptModel>(
        value: ref.watch(receiptProvider(txRef)),
        onRetry: () => ref.invalidate(receiptProvider(txRef)),
        data: (r) => _Receipt(receipt: r),
      ),
    );
  }
}

class _Receipt extends StatelessWidget {
  const _Receipt({required this.receipt});
  final ReceiptModel receipt;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final lang = s.lang;
    final theme = Theme.of(context);
    final r = receipt;
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);

    Widget row(String k, String v, {bool bold = false}) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(child: Text(k, style: bold ? const TextStyle(fontWeight: FontWeight.w800) : null)),
            const SizedBox(width: 12),
            Flexible(child: Text(v, textAlign: TextAlign.end, style: TextStyle(fontWeight: bold ? FontWeight.w800 : FontWeight.w600, fontFeatures: tabularFigures))),
          ]),
        );

    return ListView(padding: const EdgeInsets.all(16), children: [
      Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const Center(child: LowBidLogo(size: 32)),
            const SizedBox(height: 16),
            Center(child: Text(s.receipt, style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800))),
            const SizedBox(height: 4),
            Center(child: Text('${s.receiptNo} ${r.receiptNo}', style: muted)),
            if (r.issuedAt != null) Center(child: Text(formatDateTime(r.issuedAt!, lang), style: muted)),
            const Divider(height: 32),
            Text(r.item, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text('${r.customerName} · ${r.customerPhone}', style: muted),
            const Divider(height: 32),
            for (final (label, amount) in r.lines) row(label, amount.format(languageCode: lang, showCents: true)),
            const Divider(height: 24),
            row(s.totalPaid, r.totalPaid.format(languageCode: lang, showCents: true), bold: true),
            const Divider(height: 32),
            if (r.paymentMethod != null) row(s.paidWith, r.paymentMethod!),
            row(s.reference, r.txRef),
            if (r.providerReference != null) row('Chapa', r.providerReference!),
          ]),
        ),
      ),
      const SizedBox(height: 16),
      OutlinedButton.icon(
        onPressed: () {
          Clipboard.setData(ClipboardData(text: '${r.receiptNo} · ${r.txRef}'));
          showSnack(context, r.receiptNo);
        },
        icon: const Icon(Icons.copy),
        label: Text('${s.receiptNo} ${r.receiptNo}'),
      ),
      const SizedBox(height: 8),
      Center(child: Icon(Icons.verified, color: AppColors.green.withValues(alpha: 0.7))),
    ]);
  }
}
