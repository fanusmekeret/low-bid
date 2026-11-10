import 'package:flutter/material.dart';

/// LOW BID visual identity: deep teal for trust, amber for live auctions and bidding,
/// warm off-white surfaces. Prices and timers use tabular figures so they don't jitter.
class AppColors {
  const AppColors._();

  static const teal = Color(0xFF0F4C5C);
  static const tealLight = Color(0xFF7CC4D4);
  static const amber = Color(0xFFF2A541);
  static const amberInk = Color(0xFF5C3A00);
  static const red = Color(0xFFD03B3B);
  static const green = Color(0xFF2E8B57);
  static const surface = Color(0xFFFAF7F2);
  static const ink = Color(0xFF14181C);
  static const darkSurface = Color(0xFF14181C);
  static const darkCard = Color(0xFF1E2429);
}

class AppTheme {
  const AppTheme._();

  static const _radius = 14.0;

  static ThemeData light() => _build(Brightness.light);
  static ThemeData dark() => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final dark = brightness == Brightness.dark;
    final scheme = ColorScheme.fromSeed(
      seedColor: AppColors.teal,
      brightness: brightness,
      primary: dark ? AppColors.tealLight : AppColors.teal,
      secondary: AppColors.amber,
      onSecondary: AppColors.amberInk,
      error: AppColors.red,
      surface: dark ? AppColors.darkSurface : AppColors.surface,
    );
    final base = ThemeData(useMaterial3: true, colorScheme: scheme, brightness: brightness);
    final text = base.textTheme.apply(
      // Amharic (Ge'ez script) renders with Noto Sans Ethiopic where the platform font lacks it.
      fontFamilyFallback: const ['Noto Sans Ethiopic', 'Abyssinica SIL'],
    );

    return base.copyWith(
      scaffoldBackgroundColor: scheme.surface,
      textTheme: text.copyWith(
        headlineSmall: text.headlineSmall?.copyWith(fontWeight: FontWeight.w700, letterSpacing: -0.2),
        titleLarge: text.titleLarge?.copyWith(fontWeight: FontWeight.w700),
        titleMedium: text.titleMedium?.copyWith(fontWeight: FontWeight.w600),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        elevation: 0,
        scrolledUnderElevation: 0.5,
        centerTitle: false,
        titleTextStyle: text.titleLarge?.copyWith(color: scheme.onSurface),
      ),
      cardTheme: CardThemeData(
        color: dark ? AppColors.darkCard : Colors.white,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(_radius),
          side: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.5)),
        ),
        clipBehavior: Clip.antiAlias,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(_radius)),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(48),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(_radius)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: dark ? AppColors.darkCard : Colors.white,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(_radius), borderSide: BorderSide(color: scheme.outlineVariant)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(_radius), borderSide: BorderSide(color: scheme.outlineVariant)),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(_radius), borderSide: BorderSide(color: scheme.primary, width: 2)),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      ),
      chipTheme: base.chipTheme.copyWith(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999))),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: dark ? AppColors.darkCard : Colors.white,
        indicatorColor: scheme.primary.withValues(alpha: 0.14),
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      ),
      snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
    );
  }
}

/// Price and timer text: tabular figures so digits keep their width while updating.
const tabularFigures = [FontFeature.tabularFigures()];
