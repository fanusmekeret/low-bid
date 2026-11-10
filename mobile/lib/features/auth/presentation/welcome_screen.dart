import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/app_strings.dart';
import '../../../core/settings/app_settings.dart';
import '../../../core/theme/app_theme.dart';
import '../../../shared/widgets/logo.dart';

/// First launch: pick English or Amharic, then sign up or browse as a guest.
class WelcomeScreen extends ConsumerWidget {
  const WelcomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    final settings = ref.watch(appSettingsProvider);
    final t = Theme.of(context).textTheme;

    Future<void> finish(String route) async {
      await ref.read(appSettingsProvider.notifier).completeOnboarding();
      if (context.mounted) context.go(route);
    }

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const SizedBox(height: 24),
            const Align(alignment: Alignment.centerLeft, child: LowBidLogo(size: 44)),
            const Spacer(),
            Text(s.welcomeTitle, style: t.headlineMedium?.copyWith(fontWeight: FontWeight.w800, height: 1.15)),
            const SizedBox(height: 12),
            Text(s.welcomeBody, style: t.bodyLarge?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant)),
            const SizedBox(height: 32),
            Text(s.chooseLanguage, style: t.titleSmall),
            const SizedBox(height: 8),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'en', label: Text('English')),
                ButtonSegment(value: 'am', label: Text('አማርኛ')),
              ],
              selected: {settings.locale.languageCode},
              onSelectionChanged: (v) => ref.read(appSettingsProvider.notifier).setLanguage(v.first),
            ),
            const Spacer(),
            FilledButton(onPressed: () => finish('/register'), child: Text(s.getStarted)),
            const SizedBox(height: 12),
            OutlinedButton(onPressed: () => finish('/home'), child: Text(s.browseAsGuest)),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => finish('/login'),
              child: Text(s.haveAccount, style: const TextStyle(color: AppColors.teal)),
            ),
          ]),
        ),
      ),
    );
  }
}
