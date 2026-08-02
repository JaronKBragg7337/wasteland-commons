# Wasteland Commons mobile store-readiness checklist and packaging contract

Status: release contract and verification checklist; native source generated
Scope: Capacitor wrapper around the existing Vite web client for iOS and Android  
Owner: product/release owner, with engineering sign-off for each gate

This document is the definition of done for a store-submittable mobile wrapper. The native Android and iOS projects now exist under `mobile/capacitor/` and have been synced from the release web bundle. This document still does not acquire signing credentials or imply that a signed release artifact exists. The wrapper must package the web client locally; a production build must never depend on a development server, `localhost`, or an unauthenticated remote page to boot.

## Contract invariants

- The browser client remains the gameplay source of truth. Capacitor is a shell and lifecycle/integration layer, not a second gameplay implementation.
- Production traffic uses HTTPS and WSS. Cleartext HTTP and insecure WebSockets are development-only exceptions and must be rejected by the release build.
- The app may start and show its connection state with no network. Multiplayer world state, mutations, and reconnect identity remain server-authoritative.
- The shipped web assets are the exact output of the release web build. Native projects may not silently substitute a different client, API host, or feature flag set.
- App version is `MAJOR.MINOR.PATCH`; iOS `CFBundleShortVersionString` and Android `versionName` must match it. iOS `CFBundleVersion` and Android `versionCode` must increase for every store upload.
- The iOS bundle identifier and Android application ID are immutable after the first public release. Decide and record them before signing.
- Native permissions, entitlements, plugins, and bridge methods are allowlisted. No permission is added merely because a plugin makes it available.
- A failed credential, signing, device, offline, accessibility, or performance gate blocks a store release; it is not converted into a warning.

## Store-readiness checklist

Check a box only when the linked evidence is available in the release record.

### Product and web-client readiness

- [ ] Product owner has approved app name, icon, subtitle/short description, long description, support URL, privacy-policy URL, age/content rating answers, and contact details for both stores.
- [ ] The release commit is tagged and the web version, native version, changelog, and store metadata describe the same build.
- [ ] `npm run build` succeeds from a clean checkout using the repository's lockfile and produces the expected web asset directory.
- [ ] `npm run test:world` succeeds, and any client/unit/e2e tests required by the project are green.
- [ ] The Capacitor `webDir` points at the verified release output. No development `server.url`, Vite dev server, mock relay, test room, or debug overlay is reachable in the release bundle.
- [ ] Production configuration has an explicit API/WSS origin. It contains no `localhost`, loopback address, private LAN address, credentials, or test feature flags.
- [ ] Content Security Policy and native navigation rules allow only the packaged app and explicitly approved HTTPS origins. External links open through the platform browser and do not silently navigate the app shell.
- [ ] The app displays a readable build/version identifier in an inspection or support surface so a crash report can be tied to a release.

### Touch, viewport, and orientation

- [ ] The document has a mobile viewport declaration with device width and safe-area support (`viewport-fit=cover` where used). User zoom is not disabled for menus or accessibility.
- [ ] Live play is landscape-first. Portrait shows a usable menu or an accessible rotate-device explanation; it never leaves controls clipped or unreachable.
- [ ] CSS uses `env(safe-area-inset-*)` for HUD, touch controls, dialogs, and bottom action areas on notched and home-indicator devices.
- [ ] Primary touch targets are at least 44–48 CSS px, have visible pressed/focus states, and are separated enough to avoid accidental activation.
- [ ] Movement, look, interact, attack/use, dodge/sprint, build, inventory, vehicle/mech actions, pause, reconnect, and leave/reset-device actions are reachable by touch without a keyboard, mouse, controller, hover, or precise multitouch.
- [ ] The virtual stick and drag/look surfaces use pointer/touch capture correctly, do not scroll the page, and release input on `pointerup`, `pointercancel`, `touchend`, app pause, and visibility loss.
- [ ] The canvas never intercepts taps intended for a semantic button or dialog. Back navigation, system gestures, keyboard appearance, and rotation do not strand the player in a modal state.
- [ ] Text and important HUD values remain legible at the smallest supported phone viewport and at increased text size. No critical status is communicated by color alone.

### Accessibility

- [ ] Every actionable DOM control has a semantic element, accessible name, logical focus order, and a visible focus indicator.
- [ ] Connection state, reconnect progress, errors, selected-object details, validation state, and important gameplay announcements have an appropriate `aria-live`/status treatment without excessive announcement spam.
- [ ] Contrast, focus visibility, target sizing, and non-text contrast meet the project's accessibility baseline; verify with automated checks plus manual VoiceOver and TalkBack passes.
- [ ] Reduced-motion preferences reduce camera/UI transitions and nonessential animation. Audio, vibration, color, and visual effects are supplemental rather than the only signal.
- [ ] Menus, dialogs, help, settings, room join/create, and error recovery are fully operable with keyboard, switch/accessibility navigation, and screen readers where the platform exposes them.
- [ ] Canvas-only gameplay has a documented accessible fallback for status and essential actions. Do not claim the 3D scene itself is screen-reader equivalent unless that fallback is tested.
- [ ] Focus returns to the invoking control after dialogs close, and focus is not trapped behind the native keyboard or an off-screen overlay.

### Performance, thermal, and memory

- [ ] On the agreed baseline iPhone and Android device, the mobile-low profile sustains the 30 FPS target during normal traversal, two-player presence, touch input, and a representative combat/effects scene.
- [ ] Startup and first playable scene are measured on cold and warm launch. The release record contains p50/p95 time-to-first-render and time-to-playable values with device, OS, network, and build noted.
- [ ] Initial code and core-scene transfer is at or below 20 MB compressed unless the product owner approves a documented exception. Later chunks/art are streamed and show progress.
- [ ] Mobile device pixel ratio is capped around 1.25–1.5, dynamic resolution or a lower quality tier is available, and quality changes do not change simulation rules.
- [ ] WebGL context loss, low-memory pressure, background/foreground, and thermal throttling have a tested recovery or graceful degradation path.
- [ ] Distant meshes, textures, effects, and chunk state are disposed or pooled. Profiling shows no unbounded resident memory or per-frame allocation growth in a 15-minute session.
- [ ] Network and rendering budgets are measured separately: interest-managed/delta-compressed state, replaceable movement updates, reliable actions, and reliable persistence events.
- [ ] The client never ties simulation speed to render FPS, animation frame rate, or WebSocket arrival timing.

### Network, offline, and reconnect

- [ ] Packaged assets render an offline boot screen with app version and an explicit `Offline` state. The user is never shown a spinner with no explanation.
- [ ] Offline mode preserves local UI/settings and reconnect identity as appropriate, but does not fabricate server commits or promise multiplayer play without an authoritative connection.
- [ ] Server-dependent actions are disabled or clearly marked while offline. An action is replayed after reconnect only if its command ID, idempotency, ordering, and user-visible confirmation are explicitly covered by the protocol contract.
- [ ] The client reacts to browser `online`/`offline`, `visibilitychange`, `pageshow`, Capacitor app `pause`/`resume`, and network restoration by entering a visible state machine: connected, reconnecting, offline, resyncing, or failed.
- [ ] Reconnect uses bounded backoff (1, 2, 4, 8, 15, 30 seconds), heartbeat/ping-pong, the reconnect capability, and the last received `serverTick`/`worldVersion`.
- [ ] On resume, the server sends a valid delta range or a fresh snapshot plus nearby chunks. Stale local render state is replaced; uncertain commands are not silently duplicated.
- [ ] A mobile background/sleep test confirms the player slot survives the documented grace period (initially 120 seconds), committed mutations survive, and a duplicate reconnect token cannot cause duplicate gameplay state.
- [ ] Poor latency, packet loss, captive portal, DNS failure, server restart, expired room, and protocol-version mismatch each produce a recoverable, readable result.
- [ ] Production connection tests prove HTTPS/WSS certificate validation and fail if a release build falls back to cleartext or a development relay.

### iOS packaging and App Store submission

- [x] Native iOS project is generated from the pinned Capacitor version and checked in with the intended app target, scheme, deployment target, orientation policy, and generated icon/launch assets. Privacy-manifest, entitlement, signing, and device gates remain below.
- [ ] Release archive is built on a macOS/Xcode runner, installed on a physical iPhone, and smoke-tested through first launch, room join, background/resume, offline boot, reconnect, and external-link behavior.
- [ ] App Store metadata, screenshots, privacy answers, support URL, privacy-policy URL, export/compliance answers, and review notes are complete and match the binary.
- [ ] The archive contains no debug symbols or test endpoints in the shipped app unless deliberately included through the approved crash-reporting process.
- [ ] TestFlight upload, processing, installation, and upgrade from the previous build are verified before production submission.

### Android packaging and Google Play submission

- [x] Native Android project is generated from the pinned Capacitor version and checked in with the intended application ID, min/target SDK policy, orientation policy, adaptive icon, splash, network security config, and release flavor. Signing, device, and store gates remain below.
- [ ] Release AAB is built, installed, and smoke-tested on a physical Android device and the agreed emulator matrix through first launch, room join, background/resume, offline boot, reconnect, back navigation, and upgrade.
- [ ] Play listing, screenshots, privacy/data-safety answers, content rating, support URL, privacy-policy URL, and review notes are complete and match the binary.
- [ ] The AAB is inspected for debuggable components, cleartext traffic, unexpected permissions, test endpoints, duplicate native libraries, ABI coverage, and version monotonicity.
- [ ] Internal/closed-track upload, processing, installation, and upgrade from the previous build are verified before production submission.

## Platform packaging contract

### Inputs required from the web client

| Input | Contract | Release evidence |
| --- | --- | --- |
| Web output | Capacitor packages the exact clean-build output; no runtime download is required to render the shell. | Hash or manifest of packaged assets |
| Runtime origin | One approved HTTPS API origin and WSS relay origin per environment. | Release configuration review |
| Protocol | Client/server protocol version is explicit; mismatch produces an update message and no partial room. | Handshake test log |
| Identity | Reconnect token is an opaque capability, stored with platform-appropriate local storage, never placed in a URL or analytics event. | Storage and redaction test |
| State | Server is authoritative for world, inventory, combat, construction, and persistence. | Reconnect/resync test |
| Diagnostics | Build, protocol, room, connection state, server tick, and last persistence revision are available without exposing secrets. | Support screenshot/log |

### Native shell invariants

- `webDir` must be the release web output. `server.url` is prohibited in store builds.
- The native bridge exposes only approved capabilities. The initial wrapper should require no camera, microphone, contacts, location, Bluetooth, notifications, or photo-library access unless a separately approved feature adds a user-facing need and a privacy review.
- No secret, signing key, service-account JSON, API token, or server credential is bundled into web assets, native resources, source maps uploaded publicly, or the app binary.
- `allowNavigation`/equivalent navigation policy is an explicit allowlist. Room links and support links are validated before opening.
- App lifecycle events are forwarded to the web client so the connection state machine can pause input, stop unnecessary rendering, and reconnect/resync on resume.
- Status-bar, keyboard, orientation, splash, and safe-area settings are tested on a notched iPhone, an iPhone with a home indicator, and an Android device with gesture navigation.
- Crash reporting, analytics, and diagnostics are opt-in at the product/privacy layer, minimized, documented, and disabled in local development unless explicitly enabled.

### Version and artifact contract

Every release is identified by:

```text
release_version: MAJOR.MINOR.PATCH
ios_build: monotonically increasing integer
android_version_code: monotonically increasing integer
git_commit: immutable release tag/commit
web_asset_manifest: content hash or generated manifest
protocol_version: client/server handshake version
environment: staging or production
```

Required artifacts:

- staging: unsigned or development-signed iOS archive/app for device QA, debug/test Android APK where useful, and a release-candidate AAB;
- production: signed iOS IPA/archive export and signed Android AAB, plus checksums, build logs, test reports, SBOM/dependency report if the organization requires one, and store metadata snapshot;
- every artifact must be traceable to one release commit and must be reproducible from CI inputs without a developer workstation state.

## Credential-gated signing inputs

These fields cannot be completed by repository work alone. The release owner must provide account access or inject the corresponding secrets through the CI secret manager. Never commit the values below.

### Apple

| Required input | Secret/account status | Blocking use |
| --- | --- | --- |
| Apple Developer Program membership and Team ID | Account credential | Required for distribution identity and provisioning |
| Final reverse-DNS bundle identifier and registered App ID | Account access plus product decision | Must match Xcode target and App Store record |
| Apple Distribution certificate and private key, typically imported as a password-protected `.p12` | Signing secret | Required to sign a store archive/export |
| App Store provisioning profile for the final App ID | Signing asset | Required for device/store distribution as configured |
| App Store Connect app record, SKU, and role access | Account access | Required to upload and submit the app |
| App Store Connect API key `.p8`, key ID, and issuer ID, or an approved interactive-session alternative | CI credential | Required for noninteractive upload/metadata automation |
| CI keychain/import passwords and `ExportOptions.plist` distribution method | CI secret/config | Required for repeatable archive export |
| Push entitlement/certificate, only if push is later approved | Optional credential | Not a prerequisite for the initial wrapper if push is unused |

Until the first five required account/signing inputs are present and tested on a macOS runner, iOS is `credential-blocked`, not store-ready.

### Google Play / Android

| Required input | Secret/account status | Blocking use |
| --- | --- | --- |
| Google Play Console developer account and organization access | Account credential | Required to create, upload, and submit the app |
| Final application ID/package name registered in the Play Console | Account access plus product decision | Must match the Gradle namespace/application ID |
| Upload keystore/JKS, alias, keystore password, and key password | Signing secret | Required to sign the release AAB |
| Play App Signing enrollment and upload-certificate fingerprint | Account/signing decision | Required to establish the store-managed signing path |
| Google Cloud service account with Play Publisher scope, JSON/key material, or approved OIDC federation | CI credential | Required for noninteractive track upload/metadata automation |
| Play Console app record, package ownership, and release-track permissions | Account access | Required to upload and promote the AAB |
| Any approved Play Integrity or app-link credentials, only if those features are shipped | Optional credential | Not a prerequisite for the initial wrapper if unused |

Until the account, package registration, upload signing, and CI upload credential are present and tested, Android is `credential-blocked`, not store-ready. Store-managed signing may make the keystore lifecycle different, but the release contract must still record who controls the upload key and how it is recovered.

### Suggested CI secret names

Use the CI provider's encrypted secret store or short-lived identity federation. Names are conventions, not values:

```text
APPLE_TEAM_ID
APPLE_BUNDLE_ID
APPLE_CERTIFICATE_P12_BASE64
APPLE_CERTIFICATE_PASSWORD
APPLE_PROVISIONING_PROFILE_BASE64
APPSTORE_CONNECT_ISSUER_ID
APPSTORE_CONNECT_KEY_ID
APPSTORE_CONNECT_PRIVATE_KEY_P8
ANDROID_APPLICATION_ID
ANDROID_UPLOAD_KEYSTORE_BASE64
ANDROID_UPLOAD_KEYSTORE_PASSWORD
ANDROID_UPLOAD_KEY_ALIAS
ANDROID_UPLOAD_KEY_PASSWORD
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
```

CI must fail early when a production signing secret is missing. It must not fall back to a developer key, a debug keystore, ad-hoc profile, or a locally configured account.

## CI release gates

### Gate 1 — source and dependency integrity

- Run from a clean checkout at the release tag.
- Use the committed lockfile with immutable/frozen install behavior; do not mutate the lockfile in CI.
- Run secret scanning and verify that native project files, generated configs, logs, source maps, and artifacts contain no credentials or private endpoints.
- Run the web build, world validation, tests, lint/type checks available in the repository, and a dependency/license/security report required by project policy.

### Gate 2 — web-to-Capacitor packaging

- Run the approved Capacitor asset copy/sync step against the built web output.
- Assert that release config has no dev server, `localhost`, cleartext transport, mock relay, debug flag, or staging origin.
- Assert that the packaged asset manifest matches the web build manifest and that required icons, splash assets, privacy files, and platform config are present.
- Assert that version fields and protocol version agree across web config, iOS, Android, and release metadata.

### Gate 3 — static native checks

- iOS: archive with the intended scheme/configuration on a macOS runner; inspect bundle ID, entitlements, deployment target, permissions, orientation, privacy manifest, and signing identity.
- Android: build the release AAB; inspect application ID, version code/name, manifest permissions, network security, debuggable flag, min/target SDK, ABI coverage, and signing certificate.
- Fail on unexpected permissions, entitlements, exported components, cleartext rules, dev URLs, or unsigned production artifacts.

### Gate 4 — device/emulator smoke matrix

On every release candidate, test at minimum one current iPhone, one smaller/notched iPhone, one current Android phone, and one supported emulator per platform. Record OS/device/build and pass/fail for:

1. cold launch with network;
2. cold launch offline and readable offline state;
3. create/join room and two-player presence;
4. movement and every essential touch action;
5. background, sleep, rotate, keyboard/back navigation, and resume;
6. server disconnect, packet loss/latency, reconnect, snapshot/delta resync, and duplicate-command protection;
7. WebGL context loss or quality fallback where testable;
8. accessibility navigation, focus, text sizing, reduced motion, VoiceOver, and TalkBack passes;
9. upgrade from the previous store build without losing local reconnect/settings state;
10. external support/privacy link and leave/reset-device flow.

### Gate 5 — performance and reliability thresholds

- 30 FPS mobile-low target is sustained in the agreed representative scene; record frame-time percentile, not only the average.
- Initial compressed payload, time-to-playable, memory growth, battery/thermal behavior, and reconnect timings are within the approved budgets.
- No uncaught launch error, WebGL crash, fatal native exception, or unrecoverable reconnect loop appears in the smoke run.
- Release candidate is installable from the platform's internal testing channel and can be upgraded from the prior candidate.

### Gate 6 — credentialed signing and submission

- iOS archive/export and Android AAB use CI-managed production credentials only. Verify certificate/key fingerprints against the release record.
- Upload to TestFlight and Play internal/closed testing tracks succeeds from CI using noninteractive credentials.
- Store metadata and privacy declarations are reviewed against the exact binary, permissions, entitlements, SDK/plugin inventory, and data flows.
- Human release owner approves promotion, records submission IDs, and preserves the signed artifacts, checksums, logs, and rollback/previous-version reference.

## Release record template

```text
Release tag:
Git commit:
Web asset manifest:
Protocol version:
App version:
iOS build / bundle ID:
Android version code / application ID:
Staging origins tested:
Production origins tested:
Test devices and OS versions:
Performance report:
Accessibility report:
Offline/reconnect report:
iOS signing identity fingerprint:
Android upload certificate fingerprint:
TestFlight upload ID:
Play testing-track release ID:
Known exceptions and owner/date:
Release approver:
```

## Current task boundary

This contract was added as a new document. The mobile directory did not previously contain a native wrapper, so native project generation, package installation, account setup, signing, device testing, and store uploads remain future work and are intentionally not represented as complete here.
