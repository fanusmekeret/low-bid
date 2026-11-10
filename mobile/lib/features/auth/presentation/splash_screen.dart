import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/l10n/app_strings.dart';
import '../../../core/theme/app_theme.dart';
import '../../../shared/widgets/common.dart';
import '../../../shared/widgets/logo.dart';
import '../application/auth_controller.dart';

/// Shown while the saved session is restored. If the phone is offline at launch,
/// offers a retry instead of signing the user out.
class SplashScreen extends ConsumerWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    return Scaffold(
      backgroundColor: AppColors.teal,
      body: Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const LowBidLogo(size: 56, onDark: true),
          const SizedBox(height: 12),
          Text(S.of(context).tagline, style: const TextStyle(color: Colors.white70)),
          const SizedBox(height: 32),
          if (auth.hasError)
            Theme(
              data: AppTheme.dark(),
              child: ErrorState(message: S.of(context).error(auth.error!), onRetry: () => ref.invalidate(authControllerProvider)),
            )
          else
            const SizedBox.square(dimension: 28, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3)),
        ]),
      ),
    );
  }
}
