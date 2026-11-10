import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/l10n/app_strings.dart';
import '../../core/money/money.dart';
import '../../core/theme/app_theme.dart';

/// Network photo with a soft placeholder; never shows a broken-image icon over a product.
class AppNetworkImage extends StatelessWidget {
  const AppNetworkImage({super.key, required this.url, this.fit = BoxFit.cover, this.iconSize = 40});

  final String? url;
  final BoxFit fit;
  final double iconSize;

  @override
  Widget build(BuildContext context) {
    final placeholder = ColoredBox(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: Center(child: Icon(Icons.image_outlined, size: iconSize, color: Theme.of(context).colorScheme.outline)),
    );
    if (url == null || url!.isEmpty) return placeholder;
    return CachedNetworkImage(
      imageUrl: url!,
      fit: fit,
      fadeInDuration: const Duration(milliseconds: 150),
      placeholder: (_, __) => placeholder,
      errorWidget: (_, __, ___) => placeholder,
    );
  }
}

/// Loading / error / data for a Riverpod AsyncValue, with a retry button on errors.
class AsyncValueView<T> extends StatelessWidget {
  const AsyncValueView({super.key, required this.value, required this.data, this.onRetry, this.loading});

  final AsyncValue<T> value;
  final Widget Function(T data) data;
  final VoidCallback? onRetry;
  final Widget? loading;

  @override
  Widget build(BuildContext context) {
    return value.when(
      skipLoadingOnRefresh: true,
      skipLoadingOnReload: true,
      data: data,
      loading: () => loading ?? const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator())),
      error: (e, _) => ErrorState(message: S.of(context).error(e), onRetry: onRetry),
    );
  }
}

class ErrorState extends StatelessWidget {
  const ErrorState({super.key, required this.message, this.onRetry});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.cloud_off_outlined, size: 48, color: Theme.of(context).colorScheme.outline),
          const SizedBox(height: 12),
          Text(message, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyLarge),
          if (onRetry != null) ...[
            const SizedBox(height: 16),
            OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: Text(S.of(context).retry)),
          ],
        ]),
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, this.body, this.action});

  final IconData icon;
  final String title;
  final String? body;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 56, color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.5)),
          const SizedBox(height: 16),
          Text(title, textAlign: TextAlign.center, style: t.titleMedium),
          if (body != null) ...[const SizedBox(height: 8), Text(body!, textAlign: TextAlign.center, style: t.bodyMedium)],
          if (action != null) ...[const SizedBox(height: 20), action!],
        ]),
      ),
    );
  }
}

class SectionHeader extends StatelessWidget {
  const SectionHeader({super.key, required this.title, this.onSeeAll, this.leading});

  final String title;
  final VoidCallback? onSeeAll;
  final Widget? leading;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 20, 8, 10),
      child: Row(children: [
        if (leading != null) ...[leading!, const SizedBox(width: 8)],
        Expanded(child: Text(title, style: Theme.of(context).textTheme.titleLarge)),
        if (onSeeAll != null) TextButton(onPressed: onSeeAll, child: Text(S.of(context).seeAll)),
      ]),
    );
  }
}

/// Small coloured pill, e.g. "Leading", "In review".
class StatusPill extends StatelessWidget {
  const StatusPill(this.text, {super.key, required this.color, this.icon});

  final String text;
  final Color color;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(999)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (icon != null) ...[Icon(icon, size: 14, color: color), const SizedBox(width: 4)],
        Text(text, style: Theme.of(context).textTheme.labelMedium?.copyWith(color: color, fontWeight: FontWeight.w700)),
      ]),
    );
  }
}

/// Colour for the various status codes across the app.
Color statusColor(String code) {
  switch (code) {
    case 'WON':
    case 'PAID':
    case 'APPROVED':
    case 'FULFILLED':
    case 'HELD':
      return AppColors.green;
    case 'NOT_ENOUGH_BIDS':
    case 'LOST':
    case 'FAILED':
    case 'REJECTED':
    case 'CANCELLED':
    case 'SUSPENDED':
    case 'PAYMENT_EXPIRED':
    case 'EXPIRED':
      return AppColors.red;
    case 'LIVE':
    case 'BIDDING':
    case 'AWAITING_PAYMENT':
    case 'PENDING':
    case 'PENDING_REVIEW':
    case 'PENDING_APPROVAL':
    case 'DISPUTED':
      return const Color(0xFFB36B00);
    default:
      return AppColors.teal;
  }
}

/// A price in large tabular figures.
class MoneyText extends StatelessWidget {
  const MoneyText(this.money, {super.key, this.style});

  final Money money;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    final lang = Localizations.localeOf(context).languageCode;
    return Text(
      money.format(languageCode: lang),
      style: (style ?? Theme.of(context).textTheme.titleLarge)?.copyWith(fontFeatures: tabularFigures, fontWeight: FontWeight.w800),
    );
  }
}

void showSnack(BuildContext context, String message, {bool error = false}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(message),
      backgroundColor: error ? AppColors.red : null,
    ));
}
