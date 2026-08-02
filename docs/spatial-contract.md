# Wasteland Commons: Deterministic Spatial Contract

**Status:** normative design for the world, inspection tools, and multiplayer protocol  
**Schema family:** `wasteland-commons.spatial/1`  
**Scope:** authored, procedural, player-built, and networked 3D entities

This document defines the spatial truth of Wasteland Commons. It is deliberately
engine-agnostic: a renderer, physics library, server framework, or asset tool may
change, but the world must continue to have the same addressable records and the
same synchronization meaning.

The game is a shared post-apocalyptic world with settlements, survivors, robots,
dead creatures, vehicles, and customizable pilotable suits. The contract must let
a human say “the door at this grid cell is clipping into the wall,” let an agent
find the exact records, and let two devices agree about the result.

## Reference boundary

The public [`showcase-world`](https://github.com/JaronKBragg7337/showcase-world)
repository is a read-only conceptual reference. The principles extracted from it
are:

- declare the coordinate system and grid instead of leaving placement implicit;
- keep a scene-level manifest that links bounds, grid rules, constraints, and
  runtime capabilities;
- give inspection tools access to stable labels, bounds, collision proxies, and
  validation results;
- make Beauty and Inspection views projections of the same deterministic scene;
- preserve enough runtime state to reproduce what a screenshot or diagnosis
  referred to.

The reference's city, branding, layout, source code, names, asset catalog, and
exact implementation are not part of this project. The values and schemas below
are designed for Wasteland Commons, including a streamed multiplayer wasteland.

## Contract principles

1. **One spatial truth.** Rendering, gameplay, inspection, lookup, and network
   replication read the same manifest and authoritative entity state.
2. **Identity begins at creation.** An entity is registered with its stable ID,
   grid anchor, semantic type, and collision definition before it becomes
   visible or interactable.
3. **Location is mutable; identity is not.** Moving a vehicle changes its current
   address. It does not change the vehicle's entity ID.
4. **Visual generation is subordinate to identity.** A bench, wall, robot, or mech
   part may receive a new generated material without receiving a new spatial
   identity. Texture generation must never be used to hide a missing record.
5. **Human-readable is a feature.** Addresses, labels, aliases, and issue reports
   must be speakable and searchable without requiring engine vocabulary.
6. **Debug data is a view, not a second world.** Inspection overlays may expose
   more information, but they may not create alternate geometry, alternate
   collisions, or client-only spatial facts that contradict the manifest.
7. **No ID reuse.** Destroyed, replaced, or retired entities remain represented by
   a tombstone or historical record. A late packet must never be able to address a
   newly created object by an old ID.
8. **Authority is explicit.** Persistent world changes and shared simulation state
   have one server authority. Clients can predict presentation, but cannot commit
   spatial truth by themselves.
9. **Determinism is testable.** The same world seed, generator build, content
   registry, contract version, and ruleset produce the same canonical manifest
   hash.
10. **Presentation scales independently.** Desktop, iPhone, and Android may use
    different render quality, texture resolution, label density, and animation
    budgets while consuming the same spatial records and collision semantics.

## 1. Canonical world coordinate system

Every world has a versioned coordinate declaration. It is part of the world
manifest and cannot change during an active multiplayer session.

| Property | Wasteland Commons contract |
| --- | --- |
| Unit | metres |
| Up | `+Y` |
| East | `+X` |
| North | `-Z` |
| Rotation order | `YXZ` |
| Canonical position precision | `0.01m` (one centimetre) |
| Canonical angle precision | `1/4096` of a full turn |
| Horizontal cell | `4m × 4m` |
| Vertical band | `4m` |
| Sector | `256m × 256m` (64 × 64 horizontal cells) |

World-space values may be represented as floating point inside a renderer, but
manifest and network values are quantized to the declared precision before they
are hashed, compared, or committed. This prevents a PC, iPhone, and Android
client from inventing slightly different spatial truths from the same operation.

The world origin is declared in the manifest. The initial world may use
`(0, 0, 0)` as its origin, but no system may assume that all future maps are
positive or fit in one process. Negative sectors are valid.

### Grid address format

The canonical human-readable address is:

```text
Sx<sector-east>-Sn<sector-north>-E<cell-east>-N<cell-north>-V<vertical-band>
```

Examples:

```text
Sx+00-Sn+00-E004-N006-V00
Sx+02-Sn-01-E018-N042-V00
Sx-03-Sn+04-E061-N007-V02
```

The address is spoken as “sector east zero, sector north zero, east four, north
six, vertical zero.” In a selected sector, the short form `E004-N006-V00` is
acceptable, but exported records always contain the canonical form.

The axes are intentionally named `east` and `north`, not `x` and `z`, so a human
can describe a location without knowing the rendering engine. Grid indices are
zero-based within a sector. `V00` is the ground band; it is a vertical band, not
necessarily a building floor.

The address is derived from an entity's declared **anchor point**, not from the
centre of its visible bounds. Anchor roles are semantic:

- terrain or a large ruin: authored origin or foundation datum;
- building or wall: support/foundation datum;
- prop: bottom contact datum;
- actor, creature, robot, vehicle, or mech: locomotion root;
- attached part: socket transform in the parent entity;
- trigger or volume: authored origin.

An entity may cover multiple cells and vertical bands. It has one `primaryCell`
for lookup and a sorted `coveredCells` list for streaming, collision queries, and
validation.

The derivation is defined by the contract, not by a particular implementation:

```text
cellEast  = floor((worldX - originX) / 4)
cellNorth = floor((originZ - worldZ) / 4)
band      = floor((worldY - originY) / 4)

sectorEast  = floorDiv(cellEast, 64)
sectorNorth = floorDiv(cellNorth, 64)
localEast   = positiveMod(cellEast, 64)
localNorth  = positiveMod(cellNorth, 64)
```

`floorDiv` and `positiveMod` must have the same negative-coordinate behaviour on
every platform. The displayed address must always be recomputed from the
quantized anchor when a record is created or moved; clients must not accept a
client-supplied address as authoritative.

## 2. Stable identity from creation

Spatial identity is separate from visual identity, player display names, and
network connection identity.

### ID namespaces

| Namespace | Meaning | Lifecycle |
| --- | --- | --- |
| `worldId` | One persistent world/save or deterministic baseline | immutable |
| `entityId` | One concrete world entity instance | immutable, never reused |
| `spawnKey` | Deterministic recipe key for a baseline/procedural instance | immutable for that generation build |
| `prefabId` | Visual/geometry recipe or template | versioned content registry |
| `materialId` | Semantic material and texture package | versioned content registry |
| `proxyId` | One collision or trigger proxy owned by an entity | immutable within the entity |
| `slotId` | Stable attachment slot such as a mech right arm | immutable within the parent template |
| `operationId` | One server-accepted multiplayer operation | immutable, idempotency key |
| `issueKey` | One deterministic validation finding | derived and repeatable |

An `entityId` must not encode a username, email address, device identifier,
network address, or other personal information. A readable display label such as
`DOOR-03` is an alias, not identity. Two doors may have similar labels in
different settlements; lookup must still return their canonical IDs and addresses.

The implementation may use a world-local monotonic sequence, a deterministic
content-derived ID, or both, provided these rules hold:

- baseline entities are generated in a canonical `spawnKey` order;
- runtime entities are allocated by the authoritative server before replication;
- an ID is inserted into the manifest before the entity is rendered or used by
  gameplay;
- changing a mesh, material, owner, location, health state, or display name does
  not change the ID;
- an ID is never silently recycled;
- replacement creates a new ID and records the relationship to the retired one.

For a player-built wall, the client may propose a shape, anchor, material recipe,
and intended cell. The server normalizes it, allocates the entity ID, computes
the authoritative address and proxy, and returns the committed record. The
client does not get to choose the final ID.

### Creation transaction

Entity creation is an atomic spatial transaction:

1. classify the requested object and its semantic parts;
2. resolve or generate the visual recipe and record its provenance;
3. allocate the entity ID and any child or proxy IDs;
4. compute the quantized transform, anchor, primary cell, and coverage;
5. create visible bounds, support data, and collision proxies;
6. register aliases and parent/socket relationships;
7. run the creation validation gate;
8. publish the record and its accepted operation to clients.

There is no “temporary anonymous object” phase in the shared world. Local editor
previews may exist, but they are explicitly outside the manifest until committed.

### Destruction, replacement, and history

Gameplay may destroy a wall, kill a robot, salvage a vehicle, or replace a mech
part. That is a state transition, not removal of historical identity.

The record becomes `inactive` or `tombstone` with its last authoritative cell,
last revision, destroy/retire tick, and optional `replacementId`. A tombstone is
small and may be compacted into an archive after all protocol retention rules are
met, but its ID must not be reused in the world. This protects reconnects,
replays, audit trails, and late network packets.

## 3. Manifest model

The spatial contract is split into a relatively stable manifest and mutable
authoritative state. This keeps a large wasteland from sending full geometry on
every simulation tick.

### World manifest

The top-level `WorldManifest` contains at least:

```text
schemaId
worldId
worldSeed
generatorId
generatorVersion
sceneRevision
manifestHash
coordinateSystem
gridDefinition
sceneBounds
contentRegistryHash
rulesetId
rulesetVersion
sectorIndex
validationProfile
```

`manifestHash` is computed from canonical serialization of the world declaration,
active entity records, tombstones required for synchronization, and referenced
content fingerprints. It excludes wall-clock timestamps, client frame rate,
camera pose, and other presentation-only values.

### Entity manifest record

Each visible, collidable, interactive, persistent, or semantically important
object has one `EntityRecord` containing at least:

```text
entityId
kind
canonicalName
aliases[]
tags[]
status
spawnKey?
createdAtServerTick
createdByScope
parentId?
slotId?

transform:
  anchorRole
  position
  rotation
  scale

spatial:
  primaryAddress
  primaryCell
  coveredCells[]
  localOffset
  visibleBounds
  supportId?

visual:
  prefabId
  prefabVersion
  materialBindings[]
  lodPolicy

collision:
  proxyIds[]
  collisionProfile
  navigationProfile
  interactionProfile

replication:
  authorityScope
  interestPolicy
  stateSchema
  visibilityPolicy

entityRevision
```

The actual storage format may be JSON, binary, database rows, or another
representation. The field meanings and canonical serialization order are the
contract.

`kind` is a controlled semantic category, for example `terrain`, `structure`,
`prop`, `resource`, `actor`, `survivor`, `robot`, `dead-creature`, `vehicle`,
`mech`, `mech-part`, `trigger`, or `settlement-system`. It is not a substitute
for the natural-language name; both are needed.

`materialBindings` describe semantic parts, not merely mesh indices. A bench may
have `seat`, `frame`, and `fastener` bindings; a mech may have `armor`, `joint`,
`glass`, and `emitter` bindings. Each binding records its `materialId`, source or
generation provenance, physical repeat scale, and fingerprint. An AI-generated
texture can be replaced or improved without changing the bench or mech-part
entity ID. If its appearance changes, the content fingerprint and manifest
revision change so clients can invalidate their asset cache.

### Runtime entity state

Mutable simulation data is kept in `EntityState`, keyed by `entityId`, for
example:

- transform and velocity for actors, robots, vehicles, and mechs;
- health, damage, disabled, destroyed, or salvaged state;
- inventory and resource contents;
- AI role, target, task, and settlement job state;
- construction progress and ownership scope;
- door, container, power, water, and other world-system state.

State packets carry `entityId`, `entityRevision`, `serverTick`, and the changed
component fields. A state packet never creates an entity implicitly. If a client
receives an unknown ID, it requests the corresponding manifest record or ignores
the state until the server supplies it.

## 4. Collision proxies and support truth

The visible mesh is for presentation. Collision and support proxies are the
authoritative spatial surfaces used for movement, interaction, construction,
navigation, vehicles, weapons, and validation.

Every entity that can block, support, trigger, or be targeted by gameplay has one
or more proxies. A proxy record contains:

```text
proxyId
ownerEntityId
shapeType                 # box, capsule, sphere, cylinder, convex, compound, mesh
localTransform
dimensionsOrVertices
collisionLayer
collisionMask
solid
trigger
walkable
support
navigationBlocker
enabledWhen?
proxyRevision
```

Proxies should be the simplest shape that preserves gameplay truth. A ruin may
use several boxes instead of a full render mesh. A survivor may use a capsule. A
vehicle may use a compound chassis/wheel profile. A giant suit may use separate
torso, limb, weapon, and cockpit proxies so replaced parts can alter combat and
movement without invalidating the parent entity.

The contract distinguishes:

- `visibleBounds`: what the renderer displays;
- `collisionBounds`: a cheap envelope used for broad-phase checks;
- `proxies[]`: the authoritative shapes used for narrow gameplay checks;
- `supportId` and `supportDatum`: what the entity is expected to rest on;
- `allowedRelations[]`: declared overlaps such as a part inside a socket, a door
  inside its frame, or a child prop attached to a parent.

Proxy changes are manifest changes. A client may render a lower-detail visual
mesh on a phone, but it must use the same collision profile and interaction
meaning as the PC client for the same world revision. If a platform cannot run a
high-detail proxy, the server remains authoritative and the client requests a
corrective state rather than inventing a different result.

## 5. Beauty and Inspection modes

Both modes consume the same world manifest and current authoritative state.
Switching modes is a local presentation change, not a gameplay or synchronization
operation.

### Beauty mode

Beauty mode is the normal player experience:

- polished materials, lighting, animation, audio, and camera;
- no persistent labels, grid lines, proxy boxes, or issue markers;
- mobile quality profiles may reduce texture resolution, shadows, particles,
  foliage, and label density without changing spatial truth;
- selected-object details may be shown through ordinary game UI when gameplay
  calls for it.

### Inspection mode

Inspection mode exposes the contract without replacing the world:

- sector, cell, vertical-band grid, and current camera address;
- stable entity ID, readable label, kind, aliases, and current entity revision;
- primary and covered cells;
- anchor point, transform, visible bounds, collision bounds, and proxy shapes;
- support/contact datum and parent/socket relationships;
- authority scope, server tick, world revision, and manifest hash;
- validation status, stable issue keys, severity, and suggested fixes;
- material bindings and provenance fingerprints when the user is authorized to
  see them;
- a state export or screenshot bundle that records exactly what was inspected.

Inspection is layered so it remains usable on a phone. The minimum mobile view is
selected-object data and the current grid address; grid lines, labels, proxies,
coverage heatmaps, and issue markers can be enabled one layer at a time. The
overlay must not require loading every distant label or high-resolution texture.

Inspection permissions matter in multiplayer. A client may inspect all public
spatial facts and its own records. Hidden enemies, unrevealed loot, private
settlement storage, and server-only AI state must not become visible merely
because a client switches modes. The server supplies a redacted inspection record
when the requester lacks permission.

## 6. Natural-language object lookup

Natural-language lookup is an interface over the manifest, not a free-form guess.
It must return canonical records or explicitly report ambiguity.

### Resolution order

1. Exact `entityId`, `proxyId`, `operationId`, or canonical grid address.
2. Exact readable label within the current world or settlement scope.
3. Type, alias, material-part, parent/socket, and tag matches.
4. Spatial relations such as `near`, `north of`, `inside`, `blocking`, `supporting`,
   or `two cells east of`.
5. Current visibility, permission, and interest-scope filters.
6. Geometric distance and recency as tie-breakers only.

The resolver normalizes case, punctuation, common voice-transcription variants,
and known synonyms. It must preserve the original query in a diagnostic record,
then return the canonical interpretation:

```text
query: "Door 3 at sector east 0, sector north 0, east 4, north 6"
resolved:
  entityId: ENT-...
  canonicalName: settlement-gate-door
  primaryAddress: Sx+00-Sn+00-E004-N006-V00
  entityRevision: 12
  match: exact-address-plus-alias
  confidence: exact
```

Useful queries include:

- “Door 3 at `Sx+00-Sn+00-E004-N006-V00`.”
- “Which object is clipping into the wall north of the workshop?”
- “Show the hostile robot two cells east of my vehicle.”
- “Find my mech’s right shoulder part.”
- “What blocks the road through sector east two, sector north minus one?”
- “Generate the right material for this bench, then show me the record.”

If several records match, the resolver returns a short candidate list with IDs,
addresses, and differences. It must not silently choose one because a wrong
spatial repair can be worse than asking for clarification. If the record is exact
but not currently streamed to the client, the client asks the server for that
record or a redacted response.

Moving an entity changes the current address in lookup results but not historical
references in issue reports, replay events, or chat transcripts. Those references
always retain the entity ID and the address observed at that revision.

## 7. Deterministic validation

Validation runs at world generation, asset/entity creation, server commit,
manifest load, reconnect, and release verification. It operates on a canonical
snapshot, not an arbitrary renderer frame.

### Inputs

The validator input is:

```text
spatialSchemaVersion
worldId
worldSeed
generatorId + generatorVersion
contentRegistryHash
gridDefinition
sceneBounds
rulesetId + rulesetVersion
entityManifest
requiredTombstones
declaredExceptions
```

All arrays are sorted by their canonical key before hashing or comparison.
Floating-point values are quantized before validation. Wall-clock timestamps,
random UUIDs, camera state, frame rate, and device model are not validation
inputs.

### Required checks

#### Identity and structure

- schema and required fields are valid;
- every active record has one unique `entityId`;
- IDs are never reused and replacements point to valid prior records;
- aliases are scoped and do not create an unresolved exact-match collision;
- parent/child and socket graphs are acyclic and reference existing records;
- proxy IDs belong to one existing entity and are unique within the world;
- active entities have valid creation records and deterministic provenance.

#### Grid and transform

- transforms are finite and quantized to the declared precision;
- the primary address exactly matches the anchor-derived address;
- covered cells are complete, sorted, and include the primary cell;
- bounds and proxies remain inside declared scene/sector bounds unless an
  explicit streaming boundary rule allows them;
- no entity claims a different coordinate system or grid version.

#### Grounding and collision

- support-required objects touch their support datum within the configured
  contact tolerance;
- no object is unintentionally floating or buried beyond tolerance;
- proxy envelopes are compatible with visible bounds for the entity's collision
  profile;
- independent solid proxies do not intersect unless an allowed relation exists;
- triggers, navigation blockers, and walkable surfaces have valid layer/mask
  definitions;
- collision changes are accompanied by a new entity/proxy revision.

#### Gameplay and replication

- every replicated entity declares authority, interest policy, visibility policy,
  and a state schema;
- every persistent operation has an idempotency key and server tick;
- no client-only entity can be referenced by a shared operation;
- generated baseline entities reproduce from the declared seed and generator;
- a streamed sector has the same manifest hash whether loaded alone or as part of
  a larger snapshot;
- hidden/private records are not present in an unauthorized inspection payload.

#### Reproducibility

- two builds with identical inputs produce the same canonical manifest hash;
- validation issue keys are stable across runs;
- issue ordering is canonical;
- content fingerprints are present for referenced visual and material assets;
- a saved screenshot/state bundle can identify the world, revision, tick, and
  records that produced it.

### Issue records and gates

Every finding has a deterministic `issueKey` derived from the check type, primary
entity ID, optional related entity ID, field, and quantized location. It contains:

```text
issueKey
checkType
severity                 # CRITICAL, HIGH, WARNING, INFO
entityIds[]
addresses[]
expectedCondition
measuredCondition
suggestedFix
status                   # OPEN, ACKNOWLEDGED, RESOLVED, EXEMPTED
validatorVersion
```

`CRITICAL` and `HIGH` findings block world publication or multiplayer persistence
unless an explicit, versioned exception is present. Exceptions include a reason,
scope, authoring operation, and expiry/review condition; they are part of the
manifest hash. Warnings remain visible in Inspection mode and in the validation
report.

The validator must distinguish a real spatial defect from an intentional relation:
a door inside a frame, a weapon inside a mech socket, and a child prop attached
to a parent are not accidental intersections when their records declare the
relationship.

## 8. Multiplayer synchronization implications

The spatial contract assumes a server-authoritative shared world. This is the
important cross-platform choice: a PC, iPhone, and Android device do not need to
run identical floating-point physics or render identical detail, but they must
agree on the authoritative entity records and committed operations.

### Authority model

- **Server:** owns persistent world state, entity allocation, construction,
  destruction/tombstones, collision decisions, combat outcomes, NPC jobs, robot
  AI decisions, loot, vehicles, and mech part transactions.
- **Client:** owns input, camera, local presentation, touch/keyboard/gamepad
  mapping, interpolation, and optional local prediction.
- **Shared contract:** manifest identity, grid derivation, proxy meanings,
  revisions, operation ordering, and inspection records.

Peer-to-peer or client-authoritative shortcuts may be used for a local visual
effect, but may not commit a shared entity, address, collision result, inventory
change, or persistent building state.

### Session handshake

Before a client receives shared state, it sends its protocol and capability
versions. The server responds with:

```text
worldId
sessionId
spatialSchemaVersion
serverBuildId
worldRevision
manifestHash
rulesetVersion
serverTickRate
initialInterestSectors[]
```

If the client's contract or manifest hash is incompatible, it receives a full
compatible snapshot or is asked to update. A client must not silently interpret a
new grid or proxy schema with old code.

### Static manifest, dynamic state, and operations

Replication is divided into three layers:

1. **Manifest layer:** entity records, geometry/material references, grid
   coverage, proxies, aliases, and permissions. Sent once per relevant region or
   when the manifest revision changes.
2. **State layer:** transforms, velocities, health, AI, inventories, construction
   progress, and other mutable components. Sent as revisions at authoritative
   server ticks.
3. **Operation layer:** accepted commands such as build, salvage, open, damage,
   destroy, assign job, attach part, or replace part. Operations are ordered,
   idempotent, and reference canonical entity IDs.

An operation contains at least:

```text
operationId
serverTick
worldRevisionBefore
worldRevisionAfter?
requestingSessionId
entityIds[]
expectedEntityRevisions[]
operationType
validatedPayload
result
```

Clients send intent and an expected revision, not an untrusted final transform.
The server rechecks permissions, current grid, support, collision, and revision
before committing. A stale construction or interaction request is rejected with
the current record, not merged by guessing.

### Interest management and streaming

The primary spatial partition for network interest is sector, with cell coverage
used for finer queries. A client subscribes to its current sector, adjacent
sectors, and a larger look-ahead set for vehicles and giant suits. The server may
send simplified state outside the active area, but must preserve entity IDs and
revisions for anything that can affect a visible or authoritative result.

When an entity leaves interest range, that is a client despawn, not a world
deletion. When it returns, the server sends its manifest record if needed and the
latest state revision. A destroyed entity is sent as a tombstone or destruction
operation so stale clients cannot respawn it from an old procedural seed.

Procedural baseline content may be regenerated from `worldSeed` and `spawnKey`,
but persistent changes always win over regeneration. The server must retain the
manifest revision or delta that records a built wall, moved vehicle, killed robot,
looted container, or changed settlement system.

### Conflict handling

Two players may attempt to build in one cell, salvage one vehicle, open one door,
or replace the same mech part. The server resolves the conflict in operation
order:

- validate the first accepted operation against the current revision;
- increment the affected entity/world revision;
- reject or re-evaluate later operations with stale expected revisions;
- return the current record and a human-readable reason;
- never apply both client outcomes and hope that later rendering will reconcile
  them.

Construction may reserve a cell or support surface for a short server lease, but
the final entity record and proxy still require a committed operation. A valid
overlap must be explicit in `allowedRelations`; it must not be an accidental race.

### Procedural generation and cross-device determinism

The server does not rely on lockstep physics across PC, iPhone, and Android.
Authoritative simulation uses a fixed integer tick, quantized state, server-owned
random seeds, and deterministic random streams keyed by event/entity/tick where
randomness affects shared outcomes. Clients interpolate and may predict only
short-lived presentation.

Recommended initial defaults are a `20 Hz` authoritative simulation tick and a
render loop appropriate to the device. These are protocol values, not visual
quality promises. A mobile client can render at a lower frame rate or use lighter
materials while receiving the same authoritative positions and collision
decisions.

### Attachments and customizable mechs

The mech is an entity graph:

- the chassis has one stable parent `entityId`;
- each attachment slot has a stable `slotId` such as `right-arm` or `core`;
- each installed part has its own `entityId`, visual recipe, proxy set, and state;
- the server commits a replacement as one atomic operation;
- the old part becomes inactive/tombstoned and the new part receives a new ID;
- the resulting parent/slot/part graph is included in the next manifest revision.

Clients never infer a new weapon, armour plate, or limb from a mesh swap alone.
They receive the committed part record so damage, collision, materials, lookup,
inspection, and replay all refer to the same object.

### Inspection during multiplayer

An Inspection view may display:

```text
worldRevision / serverTick / manifestHash
selectedEntityId / entityRevision
primaryAddress / coveredCells
authority / owner scope / replication status
visible bounds / collision proxies / support relation
last accepted operationId
validation issue keys
```

This makes a report such as “Wall `ENT-...` at `Sx+02-Sn-01-E018-N042-V00`
clipped into Door `ENT-...` at server tick 18420” reproducible on both devices.
The inspector must label whether each value came from the authoritative server,
the local prediction layer, or a client-only visual calculation.

## 9. Worked spatial lifecycles

### A new object with generated materials

When the world generator decides to create a roadside bench, it first creates a
semantic description: seat, frame, fasteners, support feet, and intended wasteland
context. The material pipeline may generate or select appropriate wood, painted
metal, and oxidized fastener textures. It then commits one entity record, its
material bindings, visible bounds, support datum, collision proxies, aliases, and
grid address together. A later texture improvement changes a material fingerprint
and manifest revision, not the bench ID or its location history.

### A player-built community wall

The client sends an intent to place a wall near a named foundation. The server
resolves the target entity, snaps the proposed anchor to the declared precision,
checks support and intersection rules, allocates a new entity ID, creates the
proxy, validates the record, and broadcasts the accepted operation. The second
player receives the same ID, address, proxy profile, and revision on either phone
or PC.

### A destroyed robot

The robot remains addressable in history after destruction. Its active state
changes to destroyed, its proxies disable, and the server publishes a tombstone
with the last address and destroy tick. Loot or salvage can be a new entity with
its own ID. A late client packet for the robot cannot affect the salvage entity.

### A mech arm replacement

The `right-arm` slot remains stable. The installed arm entity is retired; the new
weapon-arm entity is created, receives its own material bindings and collision
proxies, and is attached in one server operation. Inspection can answer both
“what is in the right-arm slot now?” and “which part was there when the mech
entered this cell?” without conflating the two IDs.

## 10. Versioning and acceptance gates

The spatial schema, grid definition, coordinate axes, quantization, collision
profiles, and validation rules are versioned. A breaking change creates a new
world contract or an explicit migration; it is never silently applied halfway
through a live session.

A world build is ready for integration only when:

- every shared entity is registered at creation;
- the canonical manifest can be regenerated and produces the expected hash;
- no unresolved `CRITICAL` or `HIGH` spatial/replication issues remain;
- address lookup returns the same entity IDs from Beauty and Inspection views;
- collision and support checks pass for the committed records;
- a reconnecting client can recover the manifest and state from a hash or delta;
- PC, iPhone, and Android clients use the same authoritative grid, IDs, proxy
  meanings, and operation results;
- inspection evidence identifies the world revision, server tick, manifest hash,
  selected IDs, and validation report.

The contract is complete when an agent or human can locate, inspect, describe,
repair, synchronize, and later reproduce any important object in the wasteland
without relying on vague visual pointing or an anonymous scene graph.
