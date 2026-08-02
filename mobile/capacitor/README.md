# Capacitor packaging and release boundary

Status: **native source generated and tracked**. The Android and iOS projects,
pinned dependency lockfile, generated icon/splash resources, and release
configuration are present. Signing, physical-device validation, and store
submission still require the platform toolchains and account credentials.

## Layout and `webDir`

When activated, `mobile/capacitor/` is the Capacitor project root:

```text
mobile/capacitor/
  capacitor.config.ts      # source configuration; no live-reload URL
  package.json             # pinned Capacitor 8.5.0 toolchain
  package-lock.json
  resources/               # CC0 product icon and splash source
  android/                 # generated Android Studio/Gradle project
  ios/                     # generated Xcode/Swift Package project
  lifecycle-bridge.ts
../../dist/                 # repository Vite release output
```

The config uses `webDir: '../../dist'`. It is resolved from this Capacitor
project directory and must contain the final `index.html` produced by the
repository's Vite build. The native shell packages that output; it must not
download the game UI at launch.

## Exact build/copy/sync sequence

Run this sequence from PowerShell after a clean checkout:

```powershell
$repo = 'G:\My Drive\Codex Active\projects\wasteland-commons'
Set-Location $repo

# 1. Install the pinned native toolchain.
Push-Location .\mobile\capacitor
npm ci
Pop-Location

# 2. Produce the only web bundle allowed into a release wrapper. This injects
#    the explicit public WSS relay so a packaged localhost WebView does not
#    attempt to connect to wss://localhost.
npm run build:web --prefix .\mobile\capacitor
if (!(Test-Path .\dist\index.html)) { throw 'Vite build did not produce dist/index.html' }

# 3. Record the build identity before copying it into native projects.
Get-FileHash .\dist\index.html -Algorithm SHA256

# 4. Copy web assets/config and update native dependencies.
Push-Location .\mobile\capacitor
npm run sync
Pop-Location
```

Use `copy` for a web asset refresh when native dependencies are unchanged. Use
`sync` after native dependency or plugin changes. Never run either command
against an unreviewed development `dist/` and then call that result a release
candidate.

## Generated platform state

1. The immutable app identity is currently `com.wastelandcommons.game` and
   the display name is `Wasteland Commons`. Change both only as a deliberate
   product/release decision before the first store submission.
2. Capacitor `8.5.0` is pinned for CLI, core, iOS, and Android, with the
   committed `mobile/capacitor/package-lock.json` as the install source.
3. The platform projects were generated and synced from the current Vite
   release output. The generated icon and splash resources come from
   `resources/icon.png` and `resources/splash.png`.
4. Open the native projects when platform toolchains are available:

   ```powershell
   npx cap open android
   npx cap open ios
   ```

5. The current Windows workstation can inspect and commit native source, but
   iOS archive/signing requires macOS/Xcode and Android release builds require
   an Android SDK/Gradle environment. Those are platform gates, not missing
   game functionality.

## Production-origin rules

There are two different origins and they must never be confused:

| Origin | Purpose | Production rule |
| --- | --- | --- |
| Capacitor local origin (`capacitor://localhost` on iOS; `https://localhost` on Android with this config) | Loads packaged Vite assets | Always bundled; never replaced by a remote page |
| Multiplayer service origin | Authoritative world, room, persistence, and realtime transport | Explicit HTTPS API origin plus WSS relay origin |

The production mobile web build receives the explicit public relay
`wss://wasteland-commons.vercel.app/api/ws` through
`tools/build-mobile-web.mjs`. Set `VITE_RELAY_URL` to an approved WSS staging
relay when producing a staging wrapper. The browser build remains host-relative
when no Vite override is provided, while the packaged build never falls back to
localhost or port 8787.

Release invariants:

- `server.url` is absent from `capacitor.config.ts`.
- `server.cleartext` remains absent/false.
- Android mixed content remains disabled.
- Any API/WSS origin is injected at build time or through a validated,
  non-secret runtime configuration; credentials never enter `dist/`.
- HTTPS/WSS certificate validation is required. A release build fails closed
  instead of silently falling back to HTTP/WS.
- Live reload is development-only. If used, it may point at a LAN Vite server
  with cleartext enabled only in an ignored local override; remove that
  override before the release build and run `npx cap copy`/`sync` again.

## App lifecycle bridge expectations

`lifecycle-bridge.ts` is the dependency-injected adapter contract. Once the
`@capacitor/app` plugin is deliberately added, pass its `App` object to
`installCapacitorLifecycleBridge` and connect the sink to the game client.
The bridge covers native `appStateChange`, `pause`, and `resume`, plus browser
`visibilitychange`, `pagehide`, and `pageshow` so desktop/mobile QA exercise
the same state machine.

The game sink must:

- On `background`: release pointer/touch capture, stop sending movement or
  action commands, pause or reduce the render loop, and enter a visible
  reconnecting/suspended state. It must not invent server commits while the
  app is asleep.
- On `active`: restore rendering and input, reconnect with the opaque stored
  identity, send the last known protocol/server-tick information, and accept a
  fresh authoritative snapshot or valid delta before enabling mutations.
- Treat a terminated-and-relaunched app like a reconnect, not like a second
  player. Uncertain commands require idempotency keys and explicit server
  acknowledgement before being retried.
- Handle Android back as an in-game pause/menu path first; leaving a room or
  exiting requires an intentional user action.
- Keep the initial wrapper permission-free: no camera, microphone, location,
  contacts, photos, Bluetooth, notifications, or background execution unless
  a separately approved feature requires one.

## Local command plan

### Web-only validation on this Windows workstation

```powershell
Set-Location 'G:\My Drive\Codex Active\projects\wasteland-commons'
npm run build
npm run test:world
npm run audit:materials -- --strict
```

Then use the existing browser QA loop at desktop, iPhone-sized, and
Android-sized viewports. This validates the web client only; it does not
validate a native WebView.

### Native debug pass

```powershell
Set-Location 'G:\My Drive\Codex Active\projects\wasteland-commons'
npm run build:web --prefix .\mobile\capacitor
Push-Location .\mobile\capacitor
npm run sync
npx cap run android
# On a macOS/Xcode runner, use: npx cap run ios
Pop-Location
```

For a development live-reload pass only, use the Capacitor live-reload
workflow against a LAN-accessible Vite server. Never commit its URL or carry
it into `npx cap copy`, `npx cap sync`, or a release configuration.

### Release-candidate pass (credential-gated)

```powershell
Set-Location 'G:\My Drive\Codex Active\projects\wasteland-commons'
npm run build:web --prefix .\mobile\capacitor
Push-Location .\mobile\capacitor
npm run sync
npx cap build android
# On a macOS/Xcode runner, archive/export the iOS scheme there.
Pop-Location
```

Before any store submission, complete the native signing, device matrix,
offline/resume, accessibility, performance, privacy, version monotonicity,
and artifact checks from `mobile/store-readiness-and-packaging-contract.md`.
The repository now contains generated source and validated static
configuration; it does not claim that a signed artifact or store review has
passed.

## Current boundary

This directory is the concrete packaging implementation. It does not contain
signing keys, provision remote credentials, sign a binary, or claim Apple/Google
store approval. Those remaining gates are recorded explicitly in the store
readiness contract so they cannot be mistaken for completed repository work.
