import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/app_strings.dart';
import '../../../core/network/api_exception.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/common.dart';
import '../../auth/application/auth_controller.dart';
import '../../auth/presentation/otp_screen.dart';
import '../../payments/data/payments_repository.dart';
import '../data/seller_repository.dart';

final banksProvider = FutureProvider.autoDispose<List<BankModel>>((ref) => ref.watch(paymentsRepositoryProvider).banks());

/// Apply to sell. After applying, the seller uploads ID documents for review.
class SellerApplyScreen extends ConsumerStatefulWidget {
  const SellerApplyScreen({super.key});

  @override
  ConsumerState<SellerApplyScreen> createState() => _SellerApplyScreenState();
}

class _SellerApplyScreenState extends ConsumerState<SellerApplyScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _tin = TextEditingController();
  final _city = TextEditingController(text: 'Addis Ababa');
  final _address = TextEditingController();
  final _bio = TextEditingController();
  final _accountName = TextEditingController();
  final _accountNo = TextEditingController();
  String _type = 'INDIVIDUAL';
  String _payout = 'TELEBIRR';
  String? _bank;
  Map<String, String> _errors = const {};
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final user = ref.read(currentUserProvider);
    if (user != null) {
      _accountName.text = user.fullName;
      _accountNo.text = user.phone;
    }
  }

  @override
  void dispose() {
    for (final c in [_name, _tin, _city, _address, _bio, _accountName, _accountNo]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    final s = S.of(context);
    if (!_form.currentState!.validate()) return;
    String? opt(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();
    setState(() {
      _busy = true;
      _errors = const {};
    });
    try {
      await ref.read(sellerRepositoryProvider).apply({
        'businessName': _name.text.trim(),
        'businessType': _type,
        if (opt(_tin) != null) 'tinNumber': opt(_tin),
        'city': _city.text.trim(),
        if (opt(_address) != null) 'address': opt(_address),
        if (opt(_bio) != null) 'bio': opt(_bio),
        'payoutMethod': _payout,
        if (_payout == 'BANK_TRANSFER') 'payoutBankCode': _bank,
        'payoutAccountName': _accountName.text.trim(),
        'payoutAccountNo': _accountNo.text.trim(),
      });
      await ref.read(authControllerProvider.notifier).refreshUser();
      ref.invalidate(sellerProfileProvider);
      if (mounted) context.pushReplacement('/seller/documents');
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _errors = e.fieldErrors);
      if (e.fieldErrors.isEmpty) showSnack(context, s.error(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final user = ref.watch(currentUserProvider);
    String? notEmpty(String? v) => (v == null || v.trim().length < 2) ? s.requiredField : null;

    if (user != null && !user.phoneVerified) {
      return Scaffold(
        appBar: AppBar(title: Text(s.sellerApply)),
        body: EmptyState(
          icon: Icons.verified_user_outlined,
          title: s.phoneNotVerified,
          action: FilledButton(onPressed: () => startPhoneVerification(context, ref, from: '/seller/apply'), child: Text(s.verifyNow)),
        ),
      );
    }

    final banks = ref.watch(banksProvider);
    return Scaffold(
      appBar: AppBar(title: Text(s.sellerApply)),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          Text(s.sellerApplyBody),
          const SizedBox(height: 16),
          TextFormField(controller: _name, decoration: InputDecoration(labelText: s.businessName, errorText: _errors['businessName']), validator: notEmpty),
          const SizedBox(height: 12),
          SegmentedButton<String>(
            segments: [ButtonSegment(value: 'INDIVIDUAL', label: Text(s.individual)), ButtonSegment(value: 'COMPANY', label: Text(s.company))],
            selected: {_type},
            onSelectionChanged: (v) => setState(() => _type = v.first),
          ),
          const SizedBox(height: 12),
          TextFormField(
            controller: _tin,
            keyboardType: TextInputType.number,
            maxLength: 10,
            decoration: InputDecoration(labelText: _type == 'COMPANY' ? s.tin : '${s.tin} (${s.optional})', errorText: _errors['tinNumber']),
            validator: (v) {
              final t = v?.trim() ?? '';
              if (t.isEmpty) return _type == 'COMPANY' ? s.requiredField : null;
              return RegExp(r'^\d{10}$').hasMatch(t) ? null : s.tinInvalid;
            },
          ),
          TextFormField(controller: _city, decoration: InputDecoration(labelText: s.city, errorText: _errors['city']), validator: notEmpty),
          const SizedBox(height: 12),
          TextFormField(controller: _address, decoration: InputDecoration(labelText: '${s.address} (${s.optional})', errorText: _errors['address'])),
          const SizedBox(height: 12),
          TextFormField(controller: _bio, maxLines: 3, maxLength: 1000, decoration: InputDecoration(labelText: '${s.bio} (${s.optional})')),
          const SizedBox(height: 8),
          Text(s.payoutMethod, style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          SegmentedButton<String>(
            segments: [ButtonSegment(value: 'TELEBIRR', label: Text(s.telebirr)), ButtonSegment(value: 'BANK_TRANSFER', label: Text(s.bankTransfer))],
            selected: {_payout},
            onSelectionChanged: (v) => setState(() => _payout = v.first),
          ),
          const SizedBox(height: 12),
          if (_payout == 'BANK_TRANSFER') ...[
            DropdownButtonFormField<String>(
              value: _bank,
              isExpanded: true,
              decoration: InputDecoration(labelText: s.bank, errorText: _errors['payoutBankCode']),
              items: [for (final b in banks.valueOrNull ?? const <BankModel>[]) if (!b.isMobileMoney) DropdownMenuItem(value: b.code, child: Text(b.name, overflow: TextOverflow.ellipsis))],
              onChanged: (v) => setState(() => _bank = v),
              validator: (v) => v == null ? s.requiredField : null,
            ),
            if (banks.hasError) TextButton(onPressed: () => ref.invalidate(banksProvider), child: Text(s.retry)),
            const SizedBox(height: 12),
          ],
          TextFormField(controller: _accountName, decoration: InputDecoration(labelText: s.accountName, errorText: _errors['payoutAccountName']), validator: notEmpty),
          const SizedBox(height: 12),
          TextFormField(
            controller: _accountNo,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(labelText: _payout == 'TELEBIRR' ? s.telebirrNumber : s.accountNumber, errorText: _errors['payoutAccountNo']),
            validator: notEmpty,
          ),
          const SizedBox(height: 24),
          FilledButton(onPressed: _busy ? null : _submit, child: _busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : Text(s.submitApplication)),
          const SizedBox(height: 24),
        ]),
      ),
    );
  }
}
