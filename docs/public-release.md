# Public release record

## Public endpoints

- Client: https://wasteland-commons.vercel.app/
- Deployment health: https://wasteland-commons.vercel.app/api/health
- Multiplayer transport: `wss://wasteland-commons.vercel.app/api/ws`
- License: CC0 1.0 Universal in `LICENSE`

## What was verified

- Production Vite build completed through Vercel.
- Two independent browser clients connected to the same public relay.
- Both clients rendered the same deterministic world and reported `CONNECTED`, `PLAYERS 2`, `BEAUTY`, and `VALIDATED`.
- Local desktop, 390×844 iPhone-sized, and 412×915 Android-sized layouts were inspected.
- Inspection mode exposed the grid and stable asset labels.
- A construction command replicated between the two clients.
- The authority protocol test piloted the seeded modular mech at its exact grid position, verified module loadout, and confirmed player/mech attachment.
- The authority regression suite verified that player input drives the boarded vehicle only for its driver.
- Reconnect behavior returned to `CONNECTED` after the relay was restarted.
- The material audit found all eight semantic materials and their generated images.

## Persistence boundary

The public relay is currently configured for local-memory state. The repository includes a server-only Supabase adapter and an RLS-protected migration, but no existing Supabase project is reused. Provisioning the dedicated project requires explicit organization and cost confirmation.

## Store boundary

The browser build is cross-platform and mobile-viewable today. `mobile/capacitor/` contains the packaging contract and lifecycle bridge, while App Store Connect / Google Play signing and submission remain credential- and platform-host dependent steps. No signing keys or service credentials are stored here.
