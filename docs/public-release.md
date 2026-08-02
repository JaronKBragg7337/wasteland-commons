# Public release record

## Public endpoints

- Client: https://wasteland-commons.vercel.app/
- Deployment health: https://wasteland-commons.vercel.app/api/health
- Public spatial/material contract: https://wasteland-commons.vercel.app/api/manifest
- Multiplayer transport: `wss://wasteland-commons.vercel.app/api/ws`
- License: CC0 1.0 Universal in `LICENSE`

## Current release record

- Source commit: `c84cd94` (`Stabilize construction support and settlement cadence`)
- Production deployment: `dpl_6yBVNYiNx4C7CUZZLdWvMkEtQMye` — READY
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
- The reproducible gate is `npm run verify:public`; its current run is intentionally failing with `sharedSnapshot: false` until the dedicated shared backend is connected.

## Persistence boundary

The public Vercel function is currently configured for instance-local memory. The repository includes a server-only Supabase persistence adapter, idempotent event migration, authority lease, durable command inbox, and regression tests, but no existing Supabase project is reused. A dedicated shared relay/state backend must be provisioned and verified before the public multiplayer gate can pass. Provisioning the dedicated project requires explicit organization and cost confirmation.

## Store boundary

The browser build is cross-platform and mobile-viewable today. `mobile/capacitor/`
now contains generated Android/iOS projects, pinned Capacitor dependencies,
generated product icon/splash assets, and an explicit WSS relay build path.
App Store Connect / Google Play signing, physical-device checks, and submission
remain credential- and platform-host dependent steps. No signing keys or
service credentials are stored here.
