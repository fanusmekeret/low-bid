import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/format/formatters.dart';
import '../../../core/l10n/app_strings.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/common.dart';
import '../data/payments_repository.dart';

final paymentHistoryProvider = FutureProvider.autoDispose<Paged<PaymentModel>>((ref) => ref.watch(paymentsRepositoryProvider).history());

class PaymentHistoryScreen extends ConsumerWidget {
  const PaymentHistoryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    final lang = s.lang;
    return Scaffold(
      appBar: AppBar(title: Text(s.paymentHistory)),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(paymentHistoryProvider.future),
        child: AsyncValueView<Paged<PaymentModel>>(
          value: ref.watch(paymentHistoryProvider),
          onRetry: () => ref.invalidate(paymentHistoryProvider),
          data: (page) => page.items.isEmpty
              ? ListView(children: [SizedBox(height: 400, child: EmptyState(icon: Icons.receipt_long_outlined, title: s.noPayments))])
              : ListView.separated(
                  physics: const AlwaysScrollableScrollPhysics(),
                  itemCount: page.items.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (_, i) {
                    final p = page.items[i];
                    return ListTile(
                      leading: CircleAvatar(child: Icon(p.purpose == 'BID_FEE' ? Icons.gavel : Icons.shopping_bag_outlined, size: 20)),
                      title: Text(s.purpose(p.purpose)),
                      subtitle: Text([if (p.createdAt != null) formatDateTime(p.createdAt!, lang), p.txRef].join('\n')),
                      isThreeLine: true,
                      trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                        Text(p.amount.format(languageCode: lang), style: const TextStyle(fontWeight: FontWeight.w800)),
                        const SizedBox(height: 4),
                        StatusPill(s.paymentStatus(p.status), color: statusColor(p.status)),
                      ]),
                      onTap: () => context.push(p.receiptNo != null ? '/payments/${p.txRef}/receipt' : '/payments/${p.txRef}'),
                    );
                  },
                ),
        ),
      ),
    );
  }
}
