import 'package:intl/intl.dart';

/// Dates shown in the user's local time. Amharic uses Latin digits and Gregorian dates here;
/// the Ethiopian calendar can be added later without touching callers.
String formatDateTime(DateTime utc, String lang) {
  final local = utc.toLocal();
  return DateFormat('d MMM yyyy, HH:mm', lang == 'am' ? 'am' : 'en').format(local);
}

String formatDate(DateTime utc, String lang) => DateFormat('d MMM yyyy', lang == 'am' ? 'am' : 'en').format(utc.toLocal());

/// "3 min ago", "2 h ago", "5 Nov".
String formatRelative(DateTime utc, String lang, {DateTime? now}) {
  final diff = (now ?? DateTime.now().toUtc()).difference(utc);
  final am = lang == 'am';
  if (diff.inSeconds < 60) return am ? 'አሁን' : 'just now';
  if (diff.inMinutes < 60) return am ? 'ከ${diff.inMinutes} ደቂቃ በፊት' : '${diff.inMinutes} min ago';
  if (diff.inHours < 24) return am ? 'ከ${diff.inHours} ሰዓት በፊት' : '${diff.inHours} h ago';
  return formatDate(utc, lang);
}
