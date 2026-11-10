import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/l10n/app_strings.dart';

/// Ethiopian mobile numbers: 09XXXXXXXX or 07XXXXXXXX (spaces and +251 allowed).
bool isValidEthiopianPhone(String input) =>
    RegExp(r'^(?:\+?251|0)?[79]\d{8}$').hasMatch(input.replaceAll(RegExp(r'[\s\-()]'), ''));

/// Same rule as the server: 8+ characters with letters and numbers.
bool isValidPassword(String v) => v.length >= 8 && RegExp('[A-Za-z]').hasMatch(v) && RegExp(r'\d').hasMatch(v);

class PhoneField extends StatelessWidget {
  const PhoneField({super.key, required this.controller, this.errorText, this.autofocus = false});

  final TextEditingController controller;
  final String? errorText;
  final bool autofocus;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    return TextFormField(
      controller: controller,
      autofocus: autofocus,
      keyboardType: TextInputType.phone,
      autofillHints: const [AutofillHints.telephoneNumber],
      inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d+\s]')), LengthLimitingTextInputFormatter(16)],
      decoration: InputDecoration(labelText: s.phone, hintText: s.phoneHint, prefixIcon: const Icon(Icons.phone_outlined), errorText: errorText),
      validator: (v) => isValidEthiopianPhone(v ?? '') ? null : s.phoneInvalid,
    );
  }
}

class PasswordField extends StatefulWidget {
  const PasswordField({super.key, required this.controller, this.label, this.errorText, this.isNew = false});

  final TextEditingController controller;
  final String? label;
  final String? errorText;
  final bool isNew;

  @override
  State<PasswordField> createState() => _PasswordFieldState();
}

class _PasswordFieldState extends State<PasswordField> {
  bool _hidden = true;

  @override
  Widget build(BuildContext context) {
    final s = S.of(context);
    return TextFormField(
      controller: widget.controller,
      obscureText: _hidden,
      autofillHints: [widget.isNew ? AutofillHints.newPassword : AutofillHints.password],
      decoration: InputDecoration(
        labelText: widget.label ?? s.password,
        helperText: widget.isNew ? s.passwordRules : null,
        errorText: widget.errorText,
        prefixIcon: const Icon(Icons.lock_outline),
        suffixIcon: IconButton(icon: Icon(_hidden ? Icons.visibility_outlined : Icons.visibility_off_outlined), onPressed: () => setState(() => _hidden = !_hidden)),
      ),
      validator: (v) {
        if ((v ?? '').isEmpty) return s.requiredField;
        if (widget.isNew && !isValidPassword(v!)) return s.passwordRules;
        return null;
      },
    );
  }
}
