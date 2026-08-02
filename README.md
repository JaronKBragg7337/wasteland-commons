# Wasteland Commons

Wasteland Commons is a browser-first cooperative post-collapse game built for a parent and child to play together across desktop, iPhone, and Android.

The world is built around a spatial contract: every meaningful object has a stable identity, a deterministic grid address, semantic material parts, collision bounds, and a validation record from the moment it enters the world. Beauty mode is the player-facing world. Inspection mode exposes the contract so a human or AI can locate, understand, and repair exact objects.

## Current game direction

The first finished release is a two-player cooperative wasteland with helpful and hostile robots, undead creatures, construction, community NPC roles, vehicles, giant robot bosses, and a modular pilotable mech suit.

The initial Saltglass Basin scene is the playable foundation. It is intentionally small enough to finish as a coherent game while its data contracts are designed to expand.

## Run locally

```text
npm install
npm run server
npm run dev
```

Open the Vite URL. The relay runs on port `8787`. Desktop uses WASD; phones use the movement pad. Click or tap world objects after enabling Inspection mode. Set `VITE_RELAY_URL` for a separately hosted WSS relay; a Vercel deployment can use the included `/api/ws` WebSocket function with the default production path.

## Public release

The current public client is [wasteland-commons.vercel.app](https://wasteland-commons.vercel.app/). Its read-only deployment check is [the health endpoint](https://wasteland-commons.vercel.app/api/health), and the browser connects to `/api/ws` over WSS. The public release is CC0-licensed and has no login requirement. The relay currently uses in-memory state; a dedicated Supabase project is an explicit next provisioning step, not an existing-project reuse.

## Release boundary

The browser client, deterministic world contracts, material provenance, local authoritative relay, optional Supabase persistence adapter, and Capacitor packaging contract live in this repository. App Store Connect and Google Play signing remain credential-gated release steps; no signing keys or service credentials belong in this project.

## Reference boundary

`showcase-world` is read-only reference material for spatial grids, stable labels, inspection layers, material catalogs, and deterministic validation. This repository is new work and does not modify or repurpose that project.
