import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/app_strings.dart';
import '../../../core/network/api_exception.dart';
import '../../../shared/widgets/common.dart';
import '../data/auth_repository.dart';
import 'auth_form.dart';

/// Two steps on one screen: send a code to the phone, then set a new password with it.
class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _form = GlobalKey<FormState>();
  final _phone = TextEditingController();
  final _code = TextEditingController();
  final _password = TextEditingController();
  bool _codeSent = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    if (!_form.currentState!.validate()) return;
    setState(() { _busy = true; _error = null; });
    try {
      await action();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = S.of(context).error(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    final repo = ref.read(authRepositoryProvider);
    return Scaffold(
      appBar: AppBar(title: Text(s.resetPassword)),
      body: SafeArea(
        child: Form(
          key: _form,
          child: ListView(padding: const EdgeInsets.all(24), children: [
            PhoneField(controller: _phone, autofocus: true),
            if (_codeSent) ...[
              const SizedBox(height: 16),
              TextFormField(
                controller: _code,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
                decoration: InputDecoration(labelText: s.enterCode, prefixIcon: const Icon(Icons.sms_outlined)),
                validator: (v) => (v ?? '').length == 6 ? null : s.enterCode,
              ),
              const SizedBox(height: 16),
              PasswordField(controller: _password, label: s.newPassword, isNew: true),
            ],
            const SizedBox(height: 20),
            if (_error != null) ...[Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)), const SizedBox(height: 12)],
            FilledButton(
              onPressed: _busy
                  ? null
                  : () => _run(() async {
                        if (!_codeSent) {
                          await repo.forgotPassword(_phone.text);
                          setState(() => _codeSent = true);
                        } else {
                          await repo.resetPassword(phone: _phone.text, code: _code.text, newPassword: _password.text);
                          if (!context.mounted) return;
                          showSnack(context, s.passwordUpdated);
                          context.go('/login');
                        }
                      }),
              child: _busy
                  ? const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
                  : Text(_codeSent ? s.resetPassword : s.sendCode),
            ),
          ]),
        ),
      ),
    );
  }
}
