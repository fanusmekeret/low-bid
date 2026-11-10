import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/app_strings.dart';
import '../../../core/network/api_exception.dart';
import '../../../shared/widgets/common.dart';
import '../../auth/application/auth_controller.dart';
import '../../auth/data/auth_repository.dart';

class EditProfileScreen extends ConsumerStatefulWidget {
  const EditProfileScreen({super.key});

  @override
  ConsumerState<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends ConsumerState<EditProfileScreen> {
  final _form = GlobalKey<FormState>();
  late final _first = TextEditingController(text: ref.read(currentUserProvider)?.firstName);
  late final _last = TextEditingController(text: ref.read(currentUserProvider)?.lastName);
  late final _email = TextEditingController(text: ref.read(currentUserProvider)?.email);
  Map<String, String> _fieldErrors = const {};
  bool _busy = false;

  @override
  void dispose() {
    _first.dispose();
    _last.dispose();
    _email.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final s = S.of(context);
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _fieldErrors = const {};
    });
    try {
      final email = _email.text.trim();
      final user = await ref.read(authRepositoryProvider).updateMe({
        'firstName': _first.text.trim(),
        'lastName': _last.text.trim(),
        'email': email.isEmpty ? null : email,
      });
      ref.read(authControllerProvider.notifier).setUser(user);
      if (!mounted) return;
      showSnack(context, s.profileSaved);
      context.pop();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _fieldErrors = e.fieldErrors);
      if (e.fieldErrors.isEmpty) showSnack(context, s.error(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    String? notEmpty(String? v) => (v == null || v.trim().isEmpty) ? s.requiredField : null;
    return Scaffold(
      appBar: AppBar(title: Text(s.editProfile)),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          TextFormField(controller: _first, decoration: InputDecoration(labelText: s.firstName, errorText: _fieldErrors['firstName']), validator: notEmpty, textCapitalization: TextCapitalization.words),
          const SizedBox(height: 12),
          TextFormField(controller: _last, decoration: InputDecoration(labelText: s.lastName, errorText: _fieldErrors['lastName']), validator: notEmpty, textCapitalization: TextCapitalization.words),
          const SizedBox(height: 12),
          TextFormField(controller: _email, decoration: InputDecoration(labelText: s.emailOptional, errorText: _fieldErrors['email']), keyboardType: TextInputType.emailAddress),
          const SizedBox(height: 24),
          FilledButton(onPressed: _busy ? null : _save, child: _busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : Text(s.save)),
        ]),
      ),
    );
  }
}
