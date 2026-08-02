# Authoritative world state

This directory is a self-contained, dependency-free ESM simulation core for
Wasteland Commons. It owns shared gameplay state and produces JSON-safe
snapshots. It does not open sockets, read files, use wall-clock time, or depend
on a renderer.

## API

```js
import { createWorld } from './authoritative/world-state.mjs';

const world = createWorld({
  worldId: 'session-abc',
  worldSeed: 'saltglass-commons-001',
});

world.enqueue({
  type: 'player.join',
  playerId: 'SURVIVOR-1',
  name: 'Rook',
  position: { x: 0, y: 0.9, z: 16 },
});

// Call once from the server's fixed 20 Hz loop.
const snapshot = world.step();
const payload = world.serializeSnapshot();
```

Commands are intents. They are queued for the next tick by default, validated
when applied, and processed in enqueue order for that tick. A command may set a
future `tick` up to 600 ticks ahead. Clients should send movement/drive intent,
target IDs, and expected gameplay choices; they should not send an authoritative
final transform or health value. Commands that can be retried should include a
stable `commandId` (or `idempotencyKey` alias), unique within a world. A retry
with the same ID and payload returns the original acknowledgement with
`duplicate: true` and is not queued again. Reusing an ID for a different payload
is rejected. The in-memory dedupe window is bounded by `commandDedupeTicks` and
`commandDedupeMaxEntries`; a durable transport or persistence layer should keep
its own idempotency record when retries can outlive one simulation process.

The snapshot contains a deterministic `snapshotId` (`worldId:revision`), the
`lastProcessedCommandSequence`, and current-tick events with deterministic
`eventId` values. These fields let a reconnecting client compare snapshots,
discard an older revision, and reconcile the last command it knows was
processed. It still receives the complete entity snapshot rather than relying
on missed events. The snapshot also contains sorted arrays for `players`, `npcs`, `robots`, `undead`,
`vehicles`, `constructions`, `mechs`, and `bosses`, plus settlement resources,
world `tick`, monotonic `revision`, and current-tick `events`. All positions are
quantized to 1 mm and all values are plain serializable data. A snapshot can be
sent directly with `JSON.stringify` or through `serializeSnapshot()`.

`restore.mjs` rehydrates a world from a persisted snapshot. It intentionally
starts with an empty command queue and dedupe window; reconnecting clients must
resync and retry only explicitly idempotent commands.

Supported command families include:

- `player.join`, `player.leave`, `player.move`, `player.attack`,
  `player.enterVehicle`, `player.exitVehicle`;
- `npc.spawn`, `npc.assign`, `robot.spawn`, `undead.spawn`;
- `vehicle.spawn`, `vehicle.drive`;
- `construction.place`;
- `mech.create`, `mech.installModule`, `mech.activate`;
- `boss.start`.

## Integration points for `server/index.mjs`

The existing relay can be integrated in four small places:

1. Create one `WorldState` per shared session at process/session startup.
2. Replace socket-side player maps with `player.join` and `player.leave`
   commands. Keep the socket itself outside this module.
3. On each WebSocket message, authenticate the session/player, validate the
   message envelope, then call `world.enqueue(command)`. Return a protocol-level
   error when it returns `{ accepted: false }`; apply-time rejections arrive in
   the next snapshot's `events` array.
4. Run a server-owned fixed interval at `1000 / snapshot.tickRate` ms. Call
   `world.step()` once per interval and broadcast the resulting serialized
   snapshot to connected clients. Do not advance the world from a socket
   callback or from a client-provided timestamp.

For reconnects, send the latest full snapshot after the player is re-associated
with its stable `playerId`. The `revision` and `tick` fields are useful for
client reconciliation. A later transport layer can add operation IDs and
interest filtering around this module without changing simulation authority.

## Validation

Run the focused tests from this directory:

```text
node --test world-state.test.mjs
```

The tests cover replay determinism, fixed-step movement, bounds, vehicle driver
authority, construction progress and grid snapping, NPC production, hostile
and buried AI, damage and boss phases, mech module installation/actions, JSON
serialization, and rejection without state mutation.
