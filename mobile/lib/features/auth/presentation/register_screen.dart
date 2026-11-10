import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/app_strings.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/settings/app_settings.dart';
import '../application/auth_controller.dart';
import 'auth_form.dart';

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key, this.from});

  final String? from;

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _form = GlobalKey<FormState>();
  final _first = TextEditingController();
  final _last = TextEditingController();
  final _phone = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;
  Map<String, String> _fieldErrors = const {};

  @override
  void dispose() {
    for (final c in [_first, _last, _phone, _email, _password]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() { _busy = true; _error = null; _fieldErrors = const {}; });
    try {
      await ref.read(authControllerProvider.notifier).register(
            phone: _phone.text,
            password: _password.text,
            firstName: _first.text.trim(),
            lastName: _last.text.trim(),
            email: _email.text.trim(),
            locale: ref.read(appSettingsProvider).locale.languageCode,
          );
      if (!mounted) return;
      context.go(Uri(path: '/otp', queryParameters: {if (widget.from != null) 'from': widget.from!}).toString());
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = S.of(context).error(e); _fieldErrors = e.fieldErrors; });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    String? req(String? v) => (v ?? '').trim().isEmpty ? s.requiredField : null;
    return Scaffold(
      appBar: AppBar(title: Text(s.createAccount)),
      body: SafeArea(
        child: Form(
          key: _form,
          child: AutofillGroup(
            child: ListView(padding: const EdgeInsets.all(24), children: [
              Row(children: [
                Expanded(child: TextFormField(controller: _first, textCapitalization: TextCapitalization.words, autofillHints: const [AutofillHints.givenName], decoration: InputDecoration(labelText: s.firstName, errorText: _fieldErrors['firstName']), validator: req)),
                const SizedBox(width: 12),
                Expanded(child: TextFormField(controller: _last, textCapitalization: TextCapitalization.words, autofillHints: const [AutofillHints.familyName], decoration: InputDecoration(labelText: s.lastName, errorText: _fieldErrors['lastName']), validator: req)),
              ]),
              const SizedBox(height: 16),
              PhoneField(controller: _phone, errorText: _fieldErrors['phone']),
              const SizedBox(height: 16),
              TextFormField(controller: _email, keyboardType: TextInputType.emailAddress, autofillHints: const [AutofillHints.email], decoration: InputDecoration(labelText: s.emailOptional, prefixIcon: const Icon(Icons.mail_outline), errorText: _fieldErrors['email'])),
              const SizedBox(height: 16),
              PasswordField(controller: _password, isNew: true, errorText: _fieldErrors['password']),
              const SizedBox(height: 20),
              if (_error != null) ...[
                Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                const SizedBox(height: 12),
              ],
              FilledButton(
                onPressed: _busy ? null : _submit,
                child: _busy ? const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2.5)) : Text(s.createAccount),
              ),
              const SizedBox(height: 12),
              TextButton(onPressed: () => context.pushReplacement('/login'), child: Text(s.haveAccount)),
            ]),
          ),
        ),
      ),
    );
  }
}
