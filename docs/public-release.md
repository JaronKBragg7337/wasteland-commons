# Public release record

## Public endpoints

- Client: https://wasteland-commons.vercel.app/
- Deployment health: https://wasteland-commons.vercel.app/api/health
- Public spatial/material contract: https://wasteland-commons.vercel.app/api/manifest
- Multiplayer transport: `wss://wasteland-commons.vercel.app/api/ws`
- License: CC0 1.0 Universal in `LICENSE`

## Current release record

- Previous production source commit: `c84cd94` (`Stabilize construction support and settlement cadence`)
- Previous production deployment: `dpl_6yBVNYiNx4C7CUZZLdWvMkEtQMye` — READY
- Current production candidate source: `31ba9ec` (`Refresh public release evidence`), deployed from `agent/supabase-release-hardening` / public PR [#1](https://github.com/JaronKBragg7337/wasteland-commons/pull/1), CI green
- Current production deployment: `dpl_3Nk2EpV4tHY7jCUR7fXw1isxCahp` — READY, aliased to `https://wasteland-commons.vercel.app`
- Manifest hash: `2332c91ca27b9abe625edce1a289a1f2d6ec9cfdd9435b9ecefa3200b57dda64`
- Browser verification rerun: desktop, 390×844 iPhone-sized, and 412×915 Android-sized viewports; construction remained `VALIDATED` after the authoritative round trip.

## What was verified

- Production Vite build completed through Vercel.
- The public endpoint serves the client and reports its current release gate at `/api/health`.
- The public manifest endpoint exposes the CC0 world contract, 320m × 256m bounds, 4m grid, three sectors, stable record IDs, and material hashes without exposing server credentials.
- The local authoritative relay passed the two-client protocol test, including shared player state and construction replication.
- A fresh production two-client WebSocket audit completed both handshakes, but the clients received isolated player lists because Vercel function instances do not share the in-memory world. Public shared multiplayer is therefore not marked passed.
- Local desktop, 390×844 iPhone-sized, and 412×915 Android-sized layouts were inspected.
- Fresh public visual inspection passed at the default desktop viewport and 390×844 phone viewport: `CONNECTED`, `BEAUTY`, `VALIDATED`, responsive controls, and no visible layout overflow.
- Inspection mode exposed the grid and stable asset labels.
- Public Inspection mode and the Build action completed with visible status feedback before returning to Beauty mode.
- A construction command replicated between two clients on the local authoritative relay.
- The authority protocol test piloted the seeded modular mech at its exact grid position, verified module loadout, and confirmed player/mech attachment.
- The authority regression suite verified that player input drives the boarded vehicle only for its driver.
- Reconnect behavior returned to `CONNECTED` after the relay was restarted.
- The material audit found all eight semantic materials and their generated images.
- The current candidate was visually rechecked at the default desktop viewport, 390×844, and 412×915. Each reached `CONNECTED` and `VALIDATED` with no horizontal overflow; Inspection mode rendered the grid/asset overlay and the Build control completed without a client error.
- The reproducible gate is `npm run verify:public`; the current production candidate reaches both WebSocket functions but reports `sharedSnapshot: false` because the server-only key is not yet present. It must be rerun after the Vercel secret handoff before release sign-off.

## Persistence boundary

The public Vercel function is currently configured for instance-local memory because the server-only key has not yet been added. The dedicated Supabase project `wnwxihhjtoilmcilyyuk` in `ca-central-1` exists, and its world/event, authority-lease, durable-command, and public-access-lockdown migrations are applied. RLS is enabled and the Data API grants are revoked for `anon` and `authenticated`; the lease RPC has been exercised with competing owners and cleanup. Vercel has the non-secret project URL configured. The remaining persistence boundary is deployment of the server-only key, followed by public two-client, failover, and reload verification.

## Store boundary

The browser build is cross-platform and mobile-viewable today. `mobile/capacitor/`
now contains generated Android/iOS projects, pinned Capacitor dependencies,
generated product icon/splash assets, and an explicit WSS relay build path.
App Store Connect / Google Play signing, physical-device checks, and submission
remain credential- and platform-host dependent steps. The candidate also has a
checked-in relay-validating native web-copy script and a rebuilt Android debug
artifact; no signing keys or service credentials are stored here.
