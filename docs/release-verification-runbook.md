# Wasteland Commons Release Verification Runbook

This runbook records evidence for a Wasteland Commons release. A checkbox is
not a pass until the command, screen, URL, or log named beside it has been
captured for the exact commit being released.

## 1. Run metadata

Record before testing:

~~~text
Date/time:
Commit SHA:       git rev-parse HEAD
Build ID/version:
Tester/device:
Local or public URL:
Evidence folder/links:
~~~

Do not attach reconnect capabilities, database credentials, or private keys to
the evidence.

## 2. Local gates

From G:\My Drive\Codex Active\projects\wasteland-commons:

~~~powershell
bun install
bun run test:world
node --test server/authoritative/world-state.test.mjs
bun tools/material-audit.mjs --strict
bun run build
~~~

Record the exit code and full output for each command. The local gate is ready
only when every command exits 0, the world validation reports no issues, the
authoritative tests pass, the strict material audit reports no missing or
untracked material files, and the production build completes.

For a local browser run, use two terminals from the same project root:

~~~powershell
node server/index.mjs
bun run dev -- --host 0.0.0.0
~~~

Open the URL printed by Vite. Confirm the relay health endpoint responds at
http://localhost:8787/health before starting client checks.

## 3. Desktop two-client check

Open the local game in two separate browser tabs or windows, Client A and
Client B. Record a screenshot and the browser console/server log for the same
run.

1. Confirm both clients show CONNECTED, the same world, and PLAYERS 2.
2. Move each client independently. Confirm the other client sees the movement
   and that the server remains authoritative after a stop/rejoin.
3. Use one shared interaction, such as the relay, vehicle, or community
   action. Confirm both clients receive the resulting state once.
4. Place one community module with the build action. Confirm it appears in
   both clients at the same grid address and is not duplicated.
5. Cycle the mech module and enter/inspect a vehicle or mech location if the
   release build exposes those actions.

Evidence to record:

~~~text
Client A screenshot/log:
Client B screenshot/log:
Shared action and observed result:
Construction ID and grid address:
Server tick/world revision, if exposed:
~~~

## 4. Inspection, grid, and asset-ID check

In either client, toggle Inspection mode with I or the inspection control.
Capture one wide scene and one close-up label view.

Verify:

- the deterministic grid is visible and uses the Wasteland Commons spatial
  convention: 4 m cells, +Y up, east +X, north -Z;
- visible labels contain stable asset IDs and grid addresses, not renderer
  object indexes;
- the selected label, manifest record, collision proxy, and rendered object
  refer to the same asset ID;
- moving agents update their displayed location without changing their stable
  ID;
- collision proxies and issue markers can be toggled independently;
- the validation readout reports no current issue markers;
- a sampled label can be matched to its record in world/manifest.json.

Record two or more samples:

~~~text
Asset ID | Grid address | Manifest record checked | Collision/issue result
---------|--------------|-------------------------|------------------------
         |              |                         |
         |              |                         |
~~~

Return to Beauty mode and capture the same area so the release has paired
presentation and inspection evidence.

## 5. Mobile viewport checks

These viewport checks validate layout and touch affordances. They do not
replace testing on physical Safari and Chrome devices.

### iPhone layout: 390 x 844

Use Safari Responsive Design Mode or browser device emulation at exactly
390x844.

- load the game from a clean page load;
- verify the scene is not horizontally clipped or covered by the HUD;
- verify touch movement, inspection, interaction, build, and mech controls are
  reachable without a keyboard;
- verify status text remains readable and the selected asset/grid label is
  visible in Inspection mode;
- rotate or reload once if the test device supports it, then capture the
  post-reload connection state.

Evidence: screenshot, viewport/device name, browser version, URL, and any
console errors.

### Android layout: 412 x 915

Repeat the same checks at exactly 412x915 using Chrome Android emulation,
then repeat on a physical Android device when available. Record whether the
physical result differs from emulation.

Evidence: screenshot, viewport/device name, browser version, URL, and any
console errors.

## 6. Multiplayer reconnect check

Use the two-client setup with Client A on desktop and Client B in a mobile
viewport or physical device.

1. Perform one shared action and record its asset ID/grid address and observed
   world revision if exposed.
2. Put Client B in the background or disable its network briefly. Confirm the
   UI changes to a visible connecting/resyncing state; do not make shared
   mutations while disconnected.
3. Restore the network or foreground the app. Confirm Client B reconnects to
   the same room, receives a fresh/ordered state, and returns to active play.
4. Confirm Client A sees one player, one construction, and one shared action,
   with no duplicate player, item, vehicle, or building.
5. Reload Client B and repeat the identity/state check.

Record disconnect duration, reconnect time, close code/log, and before/after
asset IDs. A local in-memory relay restart is not persistence evidence; mark
that scenario NOT VERIFIED until the production persistence adapter and
recovery test are connected.

## 7. Public deployment evidence

For the exact release commit, record the selected public host (GitHub Pages,
Vercel, or another configured host), deployment ID, public game URL, and
multiplayer gateway URL. Do not call a preview URL production.

Useful evidence commands:

~~~powershell
git rev-parse HEAD
git status --short
gh repo view --json nameWithOwner,url,defaultBranchRef
vercel whoami
curl.exe -I https://PUBLIC_GAME_URL/
~~~

Run the browser checks above against the public URL, not localhost. Capture:

- the public page URL and HTTP response;
- the deployment/build ID and commit SHA shown by the release surface or host;
- the public license/provenance/CC0 information;
- a desktop two-client screenshot;
- 390x844 and 412x915 screenshots;
- Beauty/Inspection paired screenshots with sampled asset IDs and grid cells;
- material audit/build output from the released commit;
- the reconnect result and the gateway/server evidence;
- any public verification or release-manifest response, including its hash or
  version fields.

If any required endpoint, release field, multiplayer path, or persistence
proof is unavailable, record it as NOT VERIFIED with the blocker. Do not
replace missing evidence with a local screenshot or an unverified claim.

## Release sign-off

~~~text
[ ] Local gates: command output attached
[ ] Desktop two-client: shared state evidence attached
[ ] Inspection/grid/asset-ID: sampled manifest records attached
[ ] 390x844 iPhone: screenshot and device/browser recorded
[ ] 412x915 Android: screenshot and device/browser recorded
[ ] Reconnect: ordered resync and no-duplication evidence attached
[ ] Public deployment: exact URL, commit, build/deployment ID recorded
[ ] CC0/provenance and public verification surface checked
[ ] Unverified items and blockers explicitly listed
~~~

Release status: NOT READY until every required item is observed or an
explicitly approved scope exception is recorded.
