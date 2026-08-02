# Capacitor packaging scaffold

Status: **scaffold only**. No Capacitor packages were installed, no native
projects were generated, and no iOS/Android artifact was signed or submitted.
This directory is intentionally self-contained so the current Vite project
and its root files remain unchanged.

## Layout and `webDir`

When activated, `mobile/capacitor/` is the Capacitor project root:

```text
mobile/capacitor/
  capacitor.config.ts
  android/                 # generated later; not present in this scaffold
  ios/                     # generated later; not present in this scaffold
  lifecycle-bridge.ts
  ../../mobile/assets/wasteland-commons-icon.png
../../dist/                 # repository Vite release output
```

The config uses `webDir: '../../dist'`. It is resolved from this Capacitor
project directory and must contain the final `index.html` produced by the
repository's Vite build. The native shell packages that output; it must not
download the game UI at launch.

## Exact build/copy/sync sequence

Run this sequence from PowerShell after Capacitor dependencies and native
platforms have been intentionally enabled. The commands are documented, not
run by this scaffold:

```powershell
$repo = 'G:\My Drive\Codex Active\projects\wasteland-commons'
Set-Location $repo

# 1. Produce the only web bundle allowed into a release wrapper.
bun run build
if (!(Test-Path .\dist\index.html)) { throw 'Vite build did not produce dist/index.html' }

# 2. Record the build identity before copying it into native projects.
Get-FileHash .\dist\index.html -Algorithm SHA256

# 3. Copy web assets/config only. Use this for ordinary web-only changes.
Push-Location .\mobile\capacitor
npx cap copy
Pop-Location

# 4. Sync after adding/updating Capacitor or native plugins. This copies the
#    web bundle and updates native dependencies; it is not a substitute for
#    the release checks below.
Push-Location .\mobile\capacitor
npx cap sync
Pop-Location
```

Use `copy` for a web asset refresh. Use `sync` after native dependency or
plugin changes. Never run `copy` or `sync` against a development `dist/` and
then call that result a release candidate.

## First activation plan (intentionally not executed)

1. Choose and record the final reverse-DNS app ID. The value currently in the
   scaffold is provisional until the product owner approves it.
2. Pin one Capacitor major/minor version for `@capacitor/cli`,
   `@capacitor/core`, `@capacitor/ios`, and `@capacitor/android` in the
   mobile packaging workspace. Install nothing as part of this scaffold.
3. From `mobile/capacitor`, generate the platform projects once:

   ```powershell
   npx cap add android
   npx cap add ios
   ```

   iOS generation/build requires macOS and Xcode. Android generation/build
   requires the agreed Android SDK/Gradle toolchain. Those prerequisites are
   not being represented as available here.
4. Run the build/copy/sync sequence above, then open the native projects:

   ```powershell
   npx cap open android
   npx cap open ios
   ```

5. Keep generated native projects under this directory and commit them only
   after reviewing identifiers, permissions, orientation, icons, splash,
   privacy files, and the exact copied asset manifest.

The current source emblem is `mobile/assets/wasteland-commons-icon.png`.
Generate the required iOS and Android size/mask variants during this activation
step; the source image alone is not a completed store icon set.

## Production-origin rules

There are two different origins and they must never be confused:

| Origin | Purpose | Production rule |
| --- | --- | --- |
| Capacitor local origin (`capacitor://localhost` on iOS; `https://localhost` on Android with this config) | Loads packaged Vite assets | Always bundled; never replaced by a remote page |
| Multiplayer service origin | Authoritative world, room, persistence, and realtime transport | Explicit HTTPS API origin plus WSS relay origin |

The production web build must receive an explicit multiplayer origin, for
example `https://play.example` and `wss://play.example`. It must not derive a
production endpoint from `window.location.hostname`, use `localhost`, use a
private LAN address, or fall back to port `8787`. The current browser relay is
local development infrastructure; wiring the Vite client to an environment-
selected production origin is a separate web-client change and is not made by
this mobile-only task.

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
bun run build
bun run test:world
bun tools/material-audit.mjs --strict
```

Then use the existing browser QA loop at desktop, iPhone-sized, and
Android-sized viewports. This validates the web client only; it does not
validate a native WebView.

### Native debug pass after activation

```powershell
Set-Location 'G:\My Drive\Codex Active\projects\wasteland-commons'
bun run build
Push-Location .\mobile\capacitor
npx cap copy
npx cap run android
# On a macOS/Xcode runner, use: npx cap run ios
Pop-Location
```

For a development live-reload pass only, use the Capacitor live-reload
workflow against a LAN-accessible Vite server. Never commit its URL or carry
it into `npx cap copy`, `npx cap sync`, or a release configuration.

### Release-candidate pass (future, credential-gated)

```powershell
Set-Location 'G:\My Drive\Codex Active\projects\wasteland-commons'
bun run build
Push-Location .\mobile\capacitor
npx cap sync
npx cap build android
# On a macOS/Xcode runner, archive/export the iOS scheme there.
Pop-Location
```

Before any store submission, add the native signing, device matrix,
offline/resume, accessibility, performance, privacy, version monotonicity,
and artifact checks from `store-readiness-and-packaging-contract.md`. This
scaffold does not claim any of those gates passed.

## Current boundary

This is a concrete packaging contract and future native-project location. It
does not install packages, change `package.json`, change root Vite/server
files, generate `ios/` or `android/`, provision credentials, sign a binary,
or establish Apple/Google store readiness.
