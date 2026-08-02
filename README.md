# Wasteland Commons

Wasteland Commons is a browser-first cooperative post-collapse game built for a parent and child to play together across desktop, iPhone, and Android.

**Open the public build:** [wasteland-commons.vercel.app](https://wasteland-commons.vercel.app/) — it works without installation or a login. The public client is viewable now; the current production deployment remains instance-local until the release candidate's dedicated shared relay is connected and verified.

The world is built around a spatial contract: every meaningful object has a stable identity, a deterministic grid address, semantic material parts, collision bounds, and a validation record from the moment it enters the world. Beauty mode is the player-facing world. Inspection mode exposes the contract so a human or AI can locate, understand, and repair exact objects.

## Current game direction

The first finished release is a two-player cooperative wasteland with helpful and hostile robots, undead creatures, construction, community NPC roles, vehicles, giant robot bosses, and a modular pilotable mech suit.

The release world is a 320m × 256m authored region with three connected sectors, deterministic routes, field outposts, two boss sites, and the full cooperative loop. Its data contracts keep expansion safe without requiring a disposable prototype branch.

## Run locally

```text
npm install
npm run server
npm run dev
```

Open the Vite URL. The relay runs on port `8787`. Desktop uses WASD; phones use the movement pad. Click or tap world objects after enabling Inspection mode. Set `VITE_RELAY_URL` for a separately hosted WSS relay; a Vercel deployment can use the included `/api/ws` WebSocket function with the default production path.

## Public release

The current public client is [wasteland-commons.vercel.app](https://wasteland-commons.vercel.app/). Its read-only deployment check is [the health endpoint](https://wasteland-commons.vercel.app/api/health), its public spatial/material contract is [the manifest endpoint](https://wasteland-commons.vercel.app/api/manifest), and the browser connects to `/api/ws` over WSS. The public release is CC0-licensed and has no login requirement. The production function is still instance-local until the server-only Supabase key is added to Vercel and the two-client public gate passes. The dedicated Supabase project and relay schema already exist in the release candidate; no existing workspace project was reused.

## Release boundary

The browser client, deterministic world contracts, material provenance, local authoritative relay, optional Supabase persistence adapter, and generated Capacitor Android/iOS projects live in this repository. App Store Connect and Google Play signing remain credential-gated release steps; no signing keys or service credentials belong in this project.

## Reference boundary

`showcase-world` is read-only reference material for spatial grids, stable labels, inspection layers, material catalogs, and deterministic validation. This repository is new work and does not modify or repurpose that project.
