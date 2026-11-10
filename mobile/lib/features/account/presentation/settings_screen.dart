import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/app_strings.dart';
import '../../../core/settings/app_settings.dart';
import '../../auth/application/auth_controller.dart';
import '../../auth/data/auth_repository.dart';

/// Language and theme. The language is also saved to the account so SMS and
/// notifications arrive in the same language.
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    final settings = ref.watch(appSettingsProvider);
    final lang = settings.locale.languageCode;

    Future<void> setLanguage(String code) async {
      await ref.read(appSettingsProvider.notifier).setLanguage(code);
      if (ref.read(currentUserProvider) != null) {
        try {
          final user = await ref.read(authRepositoryProvider).updateMe({'locale': code});
          ref.read(authControllerProvider.notifier).setUser(user);
        } catch (_) {
          // The app language already changed; the account copy updates next time.
        }
      }
    }

    return Scaffold(
      appBar: AppBar(title: Text(s.settings)),
      body: ListView(children: [
        _Header(s.language),
        RadioListTile<String>(value: 'en', groupValue: lang, onChanged: (v) => setLanguage(v!), title: const Text('English')),
        RadioListTile<String>(value: 'am', groupValue: lang, onChanged: (v) => setLanguage(v!), title: const Text('አማርኛ')),
        const Divider(),
        _Header(s.theme),
        for (final (mode, label) in [(ThemeMode.system, s.themeSystem), (ThemeMode.light, s.themeLight), (ThemeMode.dark, s.themeDark)])
          RadioListTile<ThemeMode>(
            value: mode,
            groupValue: settings.themeMode,
            onChanged: (v) => ref.read(appSettingsProvider.notifier).setThemeMode(v!),
            title: Text(label),
          ),
        const Divider(),
        ListTile(title: Text(s.appName), subtitle: const Text('v0.7.0')),
      ]),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
        child: Text(text, style: Theme.of(context).textTheme.titleSmall?.copyWith(color: Theme.of(context).colorScheme.primary, fontWeight: FontWeight.w700)),
      );
}
