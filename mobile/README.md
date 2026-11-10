# LOW BID mobile app (Flutter)

Buyer and seller app for Android and iOS, in English and Amharic, for LOW BID's **lowest unique bid** auctions: each bid is a secret amount plus a bid fee paid through Chapa, and the lowest amount that only one person bid wins.

- **Stack:** Riverpod, go_router, Dio, Socket.IO.
- **Countdowns:** driven by the server clock.
- **Payments:** through Chapa's hosted checkout. The app never decides that a payment succeeded; the server verifies it with Chapa.

## Requirements

- Flutter **3.32 or newer** (Dart 3.8+). Check with `flutter --version`.
- The backend running (see `../backend/README.md`), for example on port 4000.

## 1. Create the native projects (first time only)

This folder holds `lib/`, `test/` and `pubspec.yaml`. Generate the Android and iOS projects around them:

```bash
cd mobile
flutter create . --org et.lowbid --project-name lowbid --platforms android,ios
flutter pub get
```

`flutter create .` keeps the existing `lib/` and `pubspec.yaml`. If it adds `test/widget_test.dart`, delete that file, because it refers to a counter app that does not exist.

## 2. Add the payment return link

After Chapa checkout, the backend's return page opens `lowbid://payments?tx_ref=…`, and the app shows the payment status.

**Android:** in `android/app/src/main/AndroidManifest.xml`, add the following inside the main `<activity>`:

```xml
<meta-data android:name="flutter_deeplinking_enabled" android:value="true" />
<intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="lowbid" android:host="payments" />
</intent-filter>
```

Also add the following inside `<manifest>`, so the app can open Chapa's page and the camera or gallery:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<queries>
    <intent><action android:name="android.intent.action.VIEW" /><data android:scheme="https" /></intent>
    <intent><action android:name="android.support.customtabs.action.CustomTabsService" /></intent>
</queries>
```

For a local backend over plain HTTP (`http://10.0.2.2:4000`), add `android:usesCleartextTraffic="true"` to `<application>`. **Do this in debug builds only.**

**iOS:** in `ios/Runner/Info.plist`, add:

```xml
<key>FlutterDeepLinkingEnabled</key><true/>
<key>CFBundleURLTypes</key>
<array><dict>
    <key>CFBundleURLSchemes</key><array><string>lowbid</string></array>
</dict></array>
<key>NSCameraUsageDescription</key><string>Take photos of your items and ID documents.</string>
<key>NSPhotoLibraryUsageDescription</key><string>Choose photos of your items and ID documents.</string>
```

## 3. Run

```bash
# Android emulator → the host machine is 10.0.2.2 (this is the default)
flutter run

# A real phone on the same Wi‑Fi, or iOS simulator
flutter run --dart-define=API_BASE_URL=http://192.168.1.20:4000
flutter run --dart-define=API_BASE_URL=http://localhost:4000      # iOS simulator

# Production
flutter build apk --release --dart-define=API_BASE_URL=https://api.lowbid.et
flutter build ipa --release --dart-define=API_BASE_URL=https://api.lowbid.et
```

The app holds no secrets. The Chapa secret key, JWT secrets and SMS credentials live only on the server.

## 4. Check and test

```bash
flutter analyze
flutter test
```

The tests cover:

- **Money:** exact santim parsing and formatting.
- **API models:** cards carry no price; detail, payment and won-item parsing.
- **Strings:** English and Amharic key parity, error-code translation.
- **API errors:** envelope, field errors, network failures.
- **Countdown:** phases, urgency, extension flash.

To try it with data, seed the backend (`npm run db:seed && npm run db:seed:demo`). Then sign in with a demo account. The seed prints the logins: bidder `0900000201` and seller `0900000101`, sharing one password. Set `DEMO_USER_PASSWORD` before seeding to choose that password.

## How it is organised

```
lib/
  app/            app widget, router (auth redirects, deep links), bottom-tab shell
  core/           config, Dio client (token refresh), server clock, Socket.IO, Money, strings (EN/AM), theme
  shared/         API models, common widgets, auction card, live countdown
  features/
    auth/         welcome, login, register, OTP, password reset
    home/         rails: ending soon, featured, live, categories, upcoming, new
    search/       filters (status, category, condition, sort) and infinite scroll
    auction/      detail (pinned countdown, bid fee and range, my secret bids, specs, result), bid sheet, revealed results
    account/      my bids, won (pay, receipt, confirm, refund), watchlist, notifications, settings
    payments/     Chapa checkout, status polling, history, receipts
    seller/       apply, documents, listings (spec editor, photos), schedule auction, earnings
```

### Rules the app follows

- **Prices:** auction cards never show a price. The auction page shows the item value, the bid fee and the allowed bid range.
- **Bidding:** the bid sheet sends only the amount and a fresh idempotency key. The server records the bid and returns a Chapa checkout for the bid fee, which the app opens. The bid counts once the server has verified the fee. After a dropped connection, a retry reuses the key, so a bid is never recorded twice.
- **Secrecy:** while bidding is open, the app shows only your own bids (with "Pay fee" for any fee not finished) and the number of paid bids. Nobody learns where they stand. After the close, the result and the full ranking (unique amounts first) are shown.
- **Countdowns:** they use server time (`X-Server-Time` and socket `serverTime`), not the phone's clock. The end time is fixed (no extensions), since bids are secret.
- **Payment status:** the status screen asks the server every 3 seconds, and also listens for `payment:updated`, until the payment is settled.
