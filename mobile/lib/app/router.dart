import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/settings/app_settings.dart';
import '../features/account/presentation/account_screen.dart';
import '../features/account/presentation/edit_profile_screen.dart';
import '../features/account/presentation/my_bids_screen.dart';
import '../features/account/presentation/notifications_screen.dart';
import '../features/account/presentation/settings_screen.dart';
import '../features/account/presentation/watchlist_screen.dart';
import '../features/account/presentation/won_screen.dart';
import '../features/auction/presentation/auction_detail_screen.dart';
import '../features/auction/presentation/bid_history_screen.dart';
import '../features/auth/application/auth_controller.dart';
import '../features/auth/presentation/forgot_password_screen.dart';
import '../features/auth/presentation/login_screen.dart';
import '../features/auth/presentation/otp_screen.dart';
import '../features/auth/presentation/register_screen.dart';
import '../features/auth/presentation/splash_screen.dart';
import '../features/auth/presentation/welcome_screen.dart';
import '../features/home/presentation/home_screen.dart';
import '../features/payments/presentation/payment_history_screen.dart';
import '../features/payments/presentation/payment_status_screen.dart';
import '../features/payments/presentation/receipt_screen.dart';
import '../features/search/presentation/search_screen.dart';
import 'shell.dart';

final _rootKey = GlobalKey<NavigatorState>();

/// Paths that need a signed-in user. Tab roots handle guests themselves.
const _protected = ['/watchlist', '/won', '/notifications', '/payments', '/profile', '/otp'];
const _authPages = ['/login', '/register', '/forgot-password'];

/// Bridges Riverpod state into GoRouter's refreshListenable.
class _RouterRefresh extends ChangeNotifier {
  _RouterRefresh(Ref ref) {
    ref.listen(authControllerProvider, (_, __) => notifyListeners());
    ref.listen(appSettingsProvider.select((s) => s.onboarded), (_, __) => notifyListeners());
  }
}

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = _RouterRefresh(ref);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    navigatorKey: _rootKey,
    initialLocation: '/splash',
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(authControllerProvider);
      final onboarded = ref.read(appSettingsProvider).onboarded;
      final loc = state.matchedLocation;

      // Chapa's return page opens lowbid://payments?tx_ref=…
      final txRef = state.uri.queryParameters['tx_ref'];
      if (txRef != null && !loc.startsWith('/payments/')) return '/payments/$txRef';

      // While the session loads, wait on the splash screen and remember where we were going
      // (e.g. a payment link opened from Chapa's return page).
      String toSplash() => loc == '/splash' ? state.uri.toString() : Uri(path: '/splash', queryParameters: {'from': state.uri.toString()}).toString();
      if ((auth.isLoading || auth.hasError) && !auth.hasValue) {
        final target = toSplash();
        return target == state.uri.toString() ? null : target;
      }
      if (!onboarded) return loc == '/welcome' ? null : '/welcome';

      final user = auth.valueOrNull;
      if (loc == '/splash') return state.uri.queryParameters['from'] ?? '/home';
      if (loc == '/welcome') return '/home';
      if (user == null && _protected.any(loc.startsWith)) {
        return Uri(path: '/login', queryParameters: {'from': state.uri.toString()}).toString();
      }
      if (user != null && _authPages.contains(loc)) return state.uri.queryParameters['from'] ?? '/home';
      return null;
    },
    routes: [
      GoRoute(path: '/', redirect: (_, __) => '/home'),
      GoRoute(path: '/splash', builder: (_, __) => const SplashScreen()),
      GoRoute(path: '/welcome', builder: (_, __) => const WelcomeScreen()),
      GoRoute(path: '/login', builder: (_, s) => LoginScreen(from: s.uri.queryParameters['from'])),
      GoRoute(path: '/register', builder: (_, s) => RegisterScreen(from: s.uri.queryParameters['from'])),
      GoRoute(path: '/forgot-password', builder: (_, __) => const ForgotPasswordScreen()),
      GoRoute(path: '/otp', builder: (_, s) => OtpScreen(from: s.uri.queryParameters['from'])),

      StatefulShellRoute.indexedStack(
        builder: (_, __, shell) => AppShell(navigationShell: shell),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: '/home', builder: (_, __) => const HomeScreen())]),
          StatefulShellBranch(routes: [
            GoRoute(
              path: '/search',
              builder: (_, s) => SearchScreen(
                key: ValueKey(s.uri.toString()),
                initialCategory: s.uri.queryParameters['category'],
                initialStatus: s.uri.queryParameters['status'],
                initialQuery: s.uri.queryParameters['q'],
              ),
            ),
          ]),
          StatefulShellBranch(routes: [GoRoute(path: '/my-bids', builder: (_, __) => const MyBidsScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/account', builder: (_, __) => const AccountScreen())]),
        ],
      ),

      GoRoute(path: '/auctions/:id', parentNavigatorKey: _rootKey, builder: (_, s) => AuctionDetailScreen(auctionId: s.pathParameters['id']!)),
      GoRoute(path: '/auctions/:id/bids', parentNavigatorKey: _rootKey, builder: (_, s) => BidHistoryScreen(auctionId: s.pathParameters['id']!)),
      GoRoute(path: '/watchlist', parentNavigatorKey: _rootKey, builder: (_, __) => const WatchlistScreen()),
      GoRoute(path: '/won', parentNavigatorKey: _rootKey, builder: (_, __) => const WonScreen()),
      GoRoute(path: '/notifications', parentNavigatorKey: _rootKey, builder: (_, __) => const NotificationsScreen()),
      GoRoute(path: '/settings', parentNavigatorKey: _rootKey, builder: (_, __) => const SettingsScreen()),
      GoRoute(path: '/profile/edit', parentNavigatorKey: _rootKey, builder: (_, __) => const EditProfileScreen()),
      GoRoute(path: '/payments', parentNavigatorKey: _rootKey, builder: (_, __) => const PaymentHistoryScreen()),
      GoRoute(path: '/payments/:txRef', parentNavigatorKey: _rootKey, builder: (_, s) => PaymentStatusScreen(txRef: s.pathParameters['txRef']!)),
      GoRoute(path: '/payments/:txRef/receipt', parentNavigatorKey: _rootKey, builder: (_, s) => ReceiptScreen(txRef: s.pathParameters['txRef']!)),

    ],
  );
});
