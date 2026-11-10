import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/app_strings.dart';
import '../../../core/network/api_exception.dart';
import '../../../shared/widgets/common.dart';
import '../../../shared/widgets/logo.dart';
import '../application/auth_controller.dart';
import 'auth_form.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key, this.from});

  final String? from;

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _phone = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _phone.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() { _busy = true; _error = null; });
    try {
      await ref.read(authControllerProvider.notifier).login(_phone.text, _password.text);
      if (mounted) context.go(widget.from ?? '/home');
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = S.of(context).error(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    return Scaffold(
      appBar: AppBar(),
      body: SafeArea(
        child: Form(
          key: _form,
          child: AutofillGroup(
            child: ListView(padding: const EdgeInsets.all(24), children: [
              const LowBidLogo(size: 40),
              const SizedBox(height: 28),
              Text(s.login, style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 24),
              PhoneField(controller: _phone, autofocus: true),
              const SizedBox(height: 16),
              PasswordField(controller: _password),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(onPressed: () => context.push('/forgot-password'), child: Text(s.forgotPassword)),
              ),
              if (_error != null) ...[
                Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                const SizedBox(height: 12),
              ],
              FilledButton(
                onPressed: _busy ? null : _submit,
                child: _busy ? const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2.5)) : Text(s.signIn),
              ),
              const SizedBox(height: 16),
              TextButton(
                onPressed: () => context.pushReplacement(Uri(path: '/register', queryParameters: {if (widget.from != null) 'from': widget.from!}).toString()),
                child: Text(s.noAccount),
              ),
            ]),
          ),
        ),
      ),
    );
  }
}

/// Use before an action that needs an account: sends guests to sign in and returns false.
bool requireSignedIn(BuildContext context, WidgetRef ref, {String? returnTo}) {
  if (ref.read(currentUserProvider) != null) return true;
  final from = returnTo ?? GoRouterState.of(context).uri.toString();
  context.push(Uri(path: '/login', queryParameters: {'from': from}).toString());
  showSnack(context, S.of(context).signInToContinue);
  return false;
}
