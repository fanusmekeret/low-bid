import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/l10n/app_strings.dart';
import '../../../core/theme/app_theme.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/common.dart';
import '../../../shared/widgets/logo.dart';
import '../../auth/application/auth_controller.dart';
import '../../auth/presentation/otp_screen.dart';

class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    final user = ref.watch(currentUserProvider);

    if (user == null) {
      return Scaffold(
        appBar: AppBar(title: Text(s.account)),
        body: ListView(padding: const EdgeInsets.all(24), children: [
          const SizedBox(height: 24),
          const Center(child: LowBidLogo(size: 44)),
          const SizedBox(height: 24),
          Text(s.guestTitle, textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          Text(s.guestBody, textAlign: TextAlign.center),
          const SizedBox(height: 24),
          FilledButton(onPressed: () => context.push('/login?from=/account'), child: Text(s.login)),
          const SizedBox(height: 8),
          OutlinedButton(onPressed: () => context.push('/register?from=/account'), child: Text(s.createAccount)),
          const SizedBox(height: 24),
          ListTile(leading: const Icon(Icons.settings_outlined), title: Text(s.settings), onTap: () => context.push('/settings')),
        ]),
      );
    }

    return Scaffold(
      appBar: AppBar(title: Text(s.account)),
      body: RefreshIndicator(
        onRefresh: () => ref.read(authControllerProvider.notifier).refreshUser(),
        child: ListView(children: [
          _Header(user: user),
          const Divider(),
          _tile(context, Icons.emoji_events_outlined, s.wonAuctions, '/won'),
          _tile(context, Icons.bookmark_border, s.watchlist, '/watchlist'),
          _tile(context, Icons.receipt_long_outlined, s.payments, '/payments'),
          _tile(context, Icons.notifications_outlined, s.notifications, '/notifications'),
          const Divider(),
          _tile(context, Icons.person_outline, s.editProfile, '/profile/edit'),
          _tile(context, Icons.settings_outlined, s.settings, '/settings'),
          ListTile(
            leading: const Icon(Icons.logout, color: AppColors.red),
            title: Text(s.signOut, style: const TextStyle(color: AppColors.red)),
            onTap: () => _signOut(context, ref),
          ),
          const SizedBox(height: 24),
        ]),
      ),
    );
  }

  Widget _tile(BuildContext context, IconData icon, String title, String path) =>
      ListTile(leading: Icon(icon), title: Text(title), trailing: const Icon(Icons.chevron_right), onTap: () => context.push(path));

  Future<void> _signOut(BuildContext context, WidgetRef ref) async {
    final s = S.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(s.signOutConfirm),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: Text(s.cancel)),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(s.signOut)),
        ],
      ),
    );
    if (ok == true) {
      await ref.read(authControllerProvider.notifier).logout();
      if (context.mounted) context.go('/home');
    }
  }
}

class _Header extends ConsumerWidget {
  const _Header({required this.user});
  final UserModel user;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = S.of(context);
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Row(children: [
        CircleAvatar(radius: 30, backgroundColor: AppColors.teal, child: Text(user.initials, style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w800))),
        const SizedBox(width: 16),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(user.fullName, style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
            Text(user.phone),
            const SizedBox(height: 6),
            if (user.phoneVerified)
              StatusPill(s.phoneVerified, color: AppColors.green, icon: Icons.verified_outlined)
            else
              Row(children: [
                StatusPill(s.phoneNotVerified, color: AppColors.red),
                TextButton(onPressed: () => startPhoneVerification(context, ref, from: '/account'), child: Text(s.verifyNow)),
              ]),
          ]),
        ),
      ]),
    );
  }
}
