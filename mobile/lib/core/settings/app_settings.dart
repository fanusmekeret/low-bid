import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Language and theme the user picked. Stored on the device.
class AppSettings {
  const AppSettings({required this.locale, required this.themeMode, required this.onboarded});

  final Locale locale;
  final ThemeMode themeMode;
  final bool onboarded;

  AppSettings copyWith({Locale? locale, ThemeMode? themeMode, bool? onboarded}) => AppSettings(
        locale: locale ?? this.locale,
        themeMode: themeMode ?? this.themeMode,
        onboarded: onboarded ?? this.onboarded,
      );
}

/// Overridden in main() with the loaded SharedPreferences instance.
final sharedPreferencesProvider = Provider<SharedPreferences>((ref) => throw UnimplementedError('override in main'));

class AppSettingsController extends Notifier<AppSettings> {
  static const _localeKey = 'lowbid.locale';
  static const _themeKey = 'lowbid.theme';
  static const _onboardedKey = 'lowbid.onboarded';

  SharedPreferences get _prefs => ref.read(sharedPreferencesProvider);

  @override
  AppSettings build() {
    final prefs = ref.watch(sharedPreferencesProvider);
    final lang = prefs.getString(_localeKey) ?? 'en';
    final theme = ThemeMode.values.firstWhere((m) => m.name == prefs.getString(_themeKey), orElse: () => ThemeMode.system);
    return AppSettings(locale: Locale(lang), themeMode: theme, onboarded: prefs.getBool(_onboardedKey) ?? false);
  }

  Future<void> setLanguage(String code) async {
    await _prefs.setString(_localeKey, code);
    state = state.copyWith(locale: Locale(code));
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    await _prefs.setString(_themeKey, mode.name);
    state = state.copyWith(themeMode: mode);
  }

  Future<void> completeOnboarding() async {
    await _prefs.setBool(_onboardedKey, true);
    state = state.copyWith(onboarded: true);
  }
}

final appSettingsProvider = NotifierProvider<AppSettingsController, AppSettings>(AppSettingsController.new);
