import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/l10n/app_strings.dart';
import '../core/realtime/socket_service.dart';
import '../shared/widgets/common.dart';

/// Bottom navigation with four tabs. Also shows personal live alerts (outbid, won)
/// wherever the user is in the app.
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    ref.listen<AsyncValue<LiveEvent>>(liveEventsProvider, (_, next) {
      final e = next.valueOrNull;
      if (e == null) return;
      if (e.name == 'user:won') {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(s.youWon),
          action: SnackBarAction(label: s.payNow, onPressed: () => context.push('/won')),
        ));
      } else if (e.name == 'payment:updated' && e.data['status'] == 'PAID' && e.data['refunding'] != true) {
        // A paid bid fee means the bid now counts.
        showSnack(context, e.data['purpose'] == 'BID_FEE' ? s.bidPlaced : s.paymentConfirmed);
      }
    });

    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: navigationShell.currentIndex,
        onDestinationSelected: (i) => navigationShell.goBranch(i, initialLocation: i == navigationShell.currentIndex),
        destinations: [
          NavigationDestination(icon: const Icon(Icons.home_outlined), selectedIcon: const Icon(Icons.home), label: s.navHome),
          NavigationDestination(icon: const Icon(Icons.search), label: s.navSearch),
          NavigationDestination(icon: const Icon(Icons.gavel_outlined), selectedIcon: const Icon(Icons.gavel), label: s.navMyBids),
          NavigationDestination(icon: const Icon(Icons.person_outline), selectedIcon: const Icon(Icons.person), label: s.navAccount),
        ],
      ),
    );
  }
}
