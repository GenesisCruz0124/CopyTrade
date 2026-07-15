# CopyTrade Android

Kotlin + Jetpack Compose control app for the CopyTrade engine. Talks **only** to the engine's REST API — never to MEXC directly, and never sees your MEXC API keys.

Privacy-first: no analytics SDKs, no trackers, `INTERNET` is the only permission requested.

## Requirements

- Android Studio (Koala or newer) or a JDK 17 + Android SDK command-line setup
- A running CopyTrade engine (see `../engine/README.md`) reachable from your phone, plus its `API_AUTH_TOKEN`

## Building

```bash
./gradlew assembleDebug     # debug APK for local testing
./gradlew assembleRelease   # signed release APK, see keystore setup below
```

The output APK is named `CopyTrade-v<versionName>.apk` (configured in `app/build.gradle.kts`). Bump `versionCode`/`versionName` there before every release build.

## Keystore setup for release builds

Release builds are signed only if `android/keystore.properties` exists (it is git-ignored — never commit a keystore or its passwords).

1. Generate a keystore once:
   ```bash
   keytool -genkeypair -v -keystore copytrade-release.keystore \
     -alias copytrade -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Store the `.keystore` file outside the repo (or in a git-ignored path) and create `android/keystore.properties`:
   ```properties
   storeFile=/absolute/path/to/copytrade-release.keystore
   storePassword=...
   keyAlias=copytrade
   keyPassword=...
   ```
3. `./gradlew assembleRelease` will now produce a signed, sideloadable APK.

In CI, the same file is written from GitHub Actions secrets (see `.github/workflows/android-release.yml`) — the keystore itself is base64-encoded in a repo secret, never checked in.

## Architecture

- **Repository pattern**: Retrofit `ApiService` → `EngineRepository` → Room cache → `ViewModel` (`StateFlow`) → Compose screens.
- **Polling**: screens poll the engine every 10s while in the foreground (`PollWhileForeground`); pull-to-refresh triggers an immediate refresh.
- **Settings**: server URL and language live in DataStore preferences; the bearer token lives in `EncryptedSharedPreferences` (Tink-backed AES256-GCM) — never written in plaintext.
- **Bilingual UI**: every user-facing string is defined once in `ui/strings/Strings.kt` as an English/Taglish pair (`Bi`), selected at render time by the language setting — no Android resource-qualifier locale switching involved.

## Screens

Setup/Login → Dashboard (balances, bot cards, kill switch, notification icon → Copy Signals) → Bot detail (PnL chart via Vico, orders, fills, start/pause/stop; supports spot and futures bots) → Create bot (Grid or DCA form) → Copy Signals (pending Discord-sourced futures signals — thumbnail + parsed fields, Approve/Reject; approving places a real order sized from the engine's copy-trading budget) → Trade log (filterable fills, cached in Room) → Settings (language, server, about).

Copy-signal thumbnails are loaded via Coil using an authenticated OkHttp client (same bearer token as the API), since the image lives behind `/copy-signals/:id/image` on the engine.

## Out of scope for v1

Multi-user support, automatic SL/TP order placement for copy trades, subscribing to another account's live position feed.
