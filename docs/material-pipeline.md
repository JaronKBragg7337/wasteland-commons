# Semantic Asset-to-Material Pipeline

Status: design contract for Wasteland Commons

This document defines how a plain-language object request becomes a deterministic,
inspectable, multiplayer-safe 3D asset with materials that make semantic sense.
It is an authoring and runtime contract, not an instruction to generate image
assets immediately. No image assets are part of this document.

## 1. Core rule

Material assignment begins when an object is created, not as a cleanup pass.

The pipeline must be able to answer all of these questions for every visible or
collidable object:

- What is this object?
- Which physical parts make it up?
- What material is each part supposed to be?
- Where did each material come from?
- What physical size should its texture pattern have?
- Which stable asset and material IDs should the runtime use?
- What should happen if recognition, generation, loading, or validation fails?

An object may be visually simple, but it must never be semantically anonymous.
The system can represent uncertainty; it must not hide uncertainty behind an
arbitrary random texture.

## 2. Pipeline lifecycle

Every asset follows this lifecycle:

1. **Intent** — a human or agent describes the object in ordinary language.
2. **Recognition** — the system classifies the object, its context, and its
   likely sub-parts from the description, reference images, geometry, and tags.
3. **Decomposition** — the object becomes a list of semantic parts and material
   slots.
4. **Material resolution** — each slot reuses an approved material, requests a
   generated material, or selects a documented fallback.
5. **Normalization** — imagery is made tileable or projected, converted into
   runtime maps, and checked for unwanted baked lighting or scale errors.
6. **Physical mapping** — UVs, triplanar coordinates, repeat distance, and
   orientation are assigned from real dimensions rather than visual guesswork.
7. **Validation** — semantic coverage, visual plausibility, scale, seams,
   performance, and provenance are checked.
8. **Registration** — the asset and material records enter the deterministic
   manifest with stable IDs and content hashes.
9. **Runtime delivery** — clients load the same manifest version and material
   references, with device-appropriate resolution and fallbacks.

An asset may be marked `pending`, `fallback`, or `needs-review` during authoring,
but a final public build must not silently ship an unresolved `unknown` state.

## 3. Semantic recognition

Recognition is hierarchical so an AI can work from an everyday description
without requiring engine vocabulary.

```text
category       prop | architecture | vehicle | robot | creature | mech | terrain
archetype      bench | wall | bus | scavenger-robot | undead | modular-mech
variant        municipal | improvised | rusted | hostile | heavy | player-built
context        settlement | wasteland | factory | road | underground | boss-arena
condition      new | worn | rusted | cracked | burned | overgrown | contaminated
function       seating | cover | transport | labor | combat | traversal | decoration
```

Recognition output must include:

- `semanticClass`: the best current classification;
- `candidates`: alternative classifications when evidence conflicts;
- `confidence`: a number from `0` to `1`;
- `evidence`: description terms, geometry labels, reference images, or authored
  tags that led to the result;
- `requiresReview`: whether the decomposition should be reviewed before release.

Confidence changes behavior. A high-confidence `bench` can use the bench recipe.
A low-confidence object can use a broader `furniture` recipe while preserving
the candidate list. The system must not invent a precise material breakdown just
because a precise label sounds complete.

### Recognition inputs, in priority order

1. Explicit authored semantics and gameplay role
2. Existing asset metadata and stable IDs
3. Geometry part names, sockets, and dimensions
4. Reference images supplied for the asset
5. Natural-language description and scene context
6. Shape/material inference from the generated or modeled result

The AI may infer technical implementation from a statement such as “this looks
like a cheap metal bench that has been outside for years.” The resulting record
must retain that as an inference with evidence, rather than treating it as a
fact supplied by the user.

## 4. Decomposition into semantic parts

Decomposition produces named components. Each component has a geometry region,
physical material family, visual condition, gameplay relevance, and mapping
policy. A component may use a shared material or its own generated variant.

The initial recipes should cover the objects most likely to dominate the game:

| Archetype | Typical semantic parts | Material decisions |
| --- | --- | --- |
| Bench | seat/slats, back/slats, frame, legs, fasteners, feet, optional paint/graffiti | wood or painted wood for slats; steel/aluminum/concrete for frame; small metal fasteners; dirt and oxidation are condition layers |
| Wall | structural body, facing/plaster, trim, openings, sill, debris, graffiti | concrete, brick, stone, plaster, sheet metal, or mixed layers; exposed edges may differ from the main face |
| Vehicle | body panels, glass, tires/tracks, rims, lights, interior, underbody, trim, decals, damage parts | painted metal, rusted metal, rubber, glass, fabric, plastic, dust, mud, and emissive lights; damage is a controlled overlay or variant |
| Robot | shell plates, joints, actuators, cables, sensor lenses, screens, weapons/tools, wear points | painted metal, bare metal, rubber, glass, emissive, grease, rust, scorch, and faction markings |
| Undead creature | skin/flesh, bone, teeth/claws, eyes, clothing, gear, wounds, contamination | organic rough materials, wet/dry variation, bone, fabric/leather, metal/plastic, and restrained emissive or wetness layers where appropriate |
| Modular mech | chassis, armor panels, cockpit, joints, power core, hardpoints, weapons, hydraulics, decals | player-selected armor family, metal, glass, rubber, cables, emissive energy, weapon-specific materials; every swappable part remains independently addressable |

Recipes are starting points, not forced identities. A scavenged robot assembled
from a vehicle door may retain both `robot.shell` and `vehicle.body-panel`
provenance when that distinction matters to the look or gameplay.

Each part must have:

```text
partId             stable within the asset
semanticRole       seat | frame | shell | joint | tire | skin | armor, etc.
geometryRef        mesh/submesh or procedural region
materialSlot       stable slot name
physicalBounds     measured local dimensions in meters
mappingPolicy      uv | triplanar | decal | vertex-layer | procedural
conditionLayers    rust, dust, mud, damage, wetness, contamination, paint
```

## 5. Material resolution

Resolution is ordered to preserve consistency and avoid unnecessary generation:

### 5.1 Reuse an approved material

Search the material catalog by semantic family, condition, context, physical
scale, palette, and license/provenance constraints. A material is reusable when
it is visually compatible and its physical repeat distance is known.

Examples:

- `mat:metal:painted:olive:weathered`
- `mat:wood:softwood:unfinished:dusty`
- `mat:concrete:poured:cracked:dry`
- `mat:rubber:tire:aged`

Reuse should preserve a coherent wasteland palette. “Close enough” means close
enough for the slot and context, not merely any image with a similar color.

### 5.2 Generate a new material when the catalog is insufficient

Generation is an authoring or build-time action, never a required network action
during a multiplayer match. The generation request is derived from the semantic
record and includes:

- material family and sub-type;
- physical surface description;
- wear, weather, faction, and environmental context;
- intended real-world repeat size;
- required view neutrality: no objects, text, logos, perspective, or baked
  directional shadows unless explicitly requested;
- whether the result must be tileable;
- target map set and runtime resolution;
- negative constraints such as “not glossy plastic” or “not clean showroom
  metal.”

For example, a `robot.shell` request should produce a surface description such
as “painted steel armor, chipped olive coating, exposed dark metal at impact
edges, fine dust in recesses, neutral orthographic material sample,” not a
generic prompt for “a cool robot texture.”

The image-generation result is only a source image. It becomes an approved
runtime material only after normalization, map derivation, physical-scale
calibration, seam checks, and provenance capture.

### 5.3 Use controlled condition layers

Rust, dust, mud, scorch, blood, contamination, wetness, graffiti, and damage
should usually be authored as layers or variants over a stable base material.
This keeps memory and multiplayer synchronization manageable. A condition layer
may be:

- a shared tileable material;
- a mask-driven shader layer;
- a decal or decal atlas;
- a baked variant for a hero asset.

The layer type must be recorded so the runtime can choose the cheapest valid
representation for the device tier.

## 6. Texture normalization and map policy

The authoring pipeline should prefer a compact physically based set:

```text
baseColor       sRGB color information
normal          tangent-space detail; flat normal when absent
orm             packed occlusion, roughness, metallic channels
emissive        optional, only for lights/screens/energy
height          optional authoring input; bake or omit at runtime
opacity         optional and expensive; avoid for ordinary surfaces
```

Generated or photographed source imagery must be normalized to remove accidental
camera perspective, visible seams, UI, watermarks, text, personal metadata, and
strong lighting that would be mistaken for geometry. Photo inputs should be
cropped and stripped of EXIF/location data before publication. Generated inputs
must retain the generation record even when no personal identity is included.

The pipeline must check for:

- tile seams on horizontal and vertical edges;
- repeated landmarks that reveal tiling;
- incorrect channel packing or color space;
- normals that invert or exaggerate detail;
- roughness that makes dirt look like polished plastic;
- physically implausible metallic values;
- baked shadows that fight the scene lighting;
- scale mismatch against a ruler or known object;
- over-busy detail that will shimmer on mobile screens.

## 7. Physical-scale mapping

Every reusable material has a declared repeat distance in meters. Mapping is
based on measured dimensions, not the number of UV tiles that happened to look
good on one mesh.

For a world- or local-space surface, the base mapping rule is conceptually:

```text
textureCoordinate = surfacePosition / repeatDistanceMeters
```

The actual shader may use UVs, triplanar projection, or a hybrid, but the
manifest must still record the physical intent.

Required mapping fields:

```text
repeatDistanceMeters   [x, y] or scalar for isotropic materials
texelDensity           target texels per meter for the device tier
axisConvention         which local/world axes define length and grain
rotation               deterministic orientation or seed
projection             uv | triplanar | box | decal | procedural
seamStrategy           unwrap | mirrored | blended | hidden-at-edge
```

Use UV mapping for authored hero meshes and parts with deliberate grain or
panel direction. Use triplanar or box mapping for terrain, rubble, walls, and
procedural geometry where seams are more harmful than exact UV continuity. Use
decals for small markings, graffiti, faction insignia, and localized damage.

### Orientation rules

- Wood grain follows the part's declared structural axis.
- Brick and block courses follow the wall's up axis.
- Tire tread follows the wheel's rolling direction.
- Panel seams, armor plates, and vehicle decals follow authored local axes.
- Organic skin uses UVs or carefully controlled triplanar projection; it must
  not visibly stretch over joints.
- Modular mech parts inherit a socket orientation but keep their own material
  scale and provenance.

## 8. Stable IDs and provenance

IDs describe identity; content hashes describe the current bytes. They are not
interchangeable.

Recommended forms:

```text
asset:wasteland:bench:000001
part:asset:wasteland:bench:000001:frame
mat:metal:painted:olive:weathered
matgen:sha256:<content-hash>
```

Rules:

- Allocate an asset ID at creation time.
- Allocate a part ID and material slot at decomposition time.
- Store the asset's deterministic `gridAddress`, layer, world transform, visible
  bounds, and collision bounds beside its semantic record so an agent can find
  the exact instance before inspecting its materials.
- Never silently reuse an ID for a different object.
- Keep IDs stable when meshes, textures, or visual variants change.
- Use content hashes for cache invalidation, deduplication, and verification.
- A multiplayer client must receive logical IDs and manifest version/hash, not
  depend on local AI decisions to interpret the asset.

Every material record must distinguish provenance types:

```text
sourceType       generated | photographed | authored | procedural | reused
sourceRef        catalog ID, input hash, or controlled internal reference
license          verified license or `needs-review`
generator        provider/model/version when generated
promptHash       hash of the generation prompt; store the prompt separately if
                 policy allows and it is useful for reproducibility
seed             generation seed when supported
inputHashes      hashes of reference images or masks, without private paths
transformLog     crop, tile, color, map-derivation, and packing operations
createdAt        UTC timestamp
review           automated checks, human/agent reviewer, and disposition
```

Do not publish private filesystem paths, account identifiers, EXIF coordinates,
or unnecessary personal attribution in provenance. If a source's license or
generation terms cannot support the project's public CC0 goal, the record must
remain `needs-review` and be excluded from the CC0 release bundle until cleared
or replaced.

## 9. Manifest contract

Generated materials enter the manifest only after they have a stable content
hash and a validation result. The lifecycle is:

```text
requested -> generated -> normalized -> mapped -> validated -> approved -> published
                                      \-> rejected or needs-review
```

`generated` is not equivalent to `approved`. A source image can be retained in
an authoring cache while the runtime manifest points to a fallback or an older
approved material.

The canonical manifest should contain an asset record and a separate material
record. A compact example:

```json
{
  "assetId": "asset:wasteland:bench:000001",
  "semantic": {
    "category": "prop",
    "archetype": "bench",
    "variant": "settlement-salvaged",
    "confidence": 0.97,
    "evidence": ["description", "geometry-parts", "scene-context"]
  },
  "spatial": {
    "gridAddress": "L0-H07-R03",
    "layer": "surface",
    "positionMeters": [28.0, 0.0, 12.0],
    "rotationDegrees": [0.0, 90.0, 0.0],
    "visibleBoundsMeters": { "min": [-0.9, 0.0, -0.3], "max": [0.9, 1.1, 0.3] },
    "collisionBoundsMeters": { "min": [-0.85, 0.0, -0.28], "max": [0.85, 1.05, 0.28] }
  },
  "parts": [
    {
      "partId": "asset:wasteland:bench:000001:seat",
      "semanticRole": "seat-slats",
      "geometryRef": "bench_seat",
      "materialSlot": "seat",
      "materialId": "mat:wood:softwood:unfinished:dusty",
      "repeatDistanceMeters": [0.18, 0.18],
      "mapping": "uv"
    },
    {
      "partId": "asset:wasteland:bench:000001:frame",
      "semanticRole": "frame",
      "geometryRef": "bench_frame",
      "materialSlot": "frame",
      "materialId": "matgen:sha256:example-material-hash",
      "repeatDistanceMeters": [0.25, 0.25],
      "mapping": "triplanar"
    }
  ],
  "manifestVersion": "wasteland-commons-materials-v1",
  "assetStatus": "approved"
}
```

The referenced material record must include its maps, physical scale, runtime
variants, fallback chain, content hash, and full provenance. Material IDs remain
stable even if a higher-quality map set later replaces the bytes; the manifest
revision and content hash identify which version a client loaded.

## 10. Fallback behavior

Fallbacks are explicit and ordered. They must preserve semantic readability,
physical scale, and multiplayer determinism.

### Recognition fallback

1. Use the highest-confidence recipe.
2. If confidence is below the recipe threshold, use the nearest broader recipe
   such as `furniture`, `structure`, `vehicle`, `machine`, or `creature`.
3. Preserve candidate classes and set `requiresReview: true`.
4. If no useful class exists, use `generic-prop` with a visible inspection-mode
   warning. Do not claim a precise decomposition.

### Material fallback

1. Approved exact semantic/context match
2. Approved same-family material with the closest condition and scale
3. Approved neutral family material with a condition layer disabled
4. Procedural physically scaled placeholder with flat normal and declared
   roughness
5. Neutral debug material labeled `material-pending`

The placeholder must be stable and honest. It must never be a random image or a
texture chosen solely because its color is similar. An unresolved fallback is a
validation item, not a silent success.

### Processing and streaming fallback

- If map derivation fails, use base color plus flat normal and fixed ORM values.
- If a high-resolution bundle is unavailable, load the approved lower-resolution
  bundle with the same material ID and mark the loaded tier in diagnostics.
- If a client cannot support a material feature, disable the optional layer and
  preserve the base material and physical repeat distance.
- If a generated asset is unavailable during a match, every client uses the same
  approved fallback mapping from the manifest; clients do not generate their
  own replacements.
- If a material is missing from a manifest version, fail loudly in inspection
  mode and use `material-pending` in play mode rather than blocking the entire
  scene.

## 11. Runtime and device budgets

Material generation, normalization, and approval are build-time operations. A
match must never wait on an AI image call. Runtime budgets are starting limits
for a browser game that must run on desktop, iPhone, and Android; they can be
revised after profiling, but revisions belong in a versioned performance
contract.

| Budget | Mobile baseline | Desktop baseline |
| --- | ---: | ---: |
| Runtime texture maps per material | baseColor + packed ORM + optional normal | baseColor + packed ORM + optional normal |
| Common material resolution | 512 px | 1024 px |
| Hero material resolution | 1024 px | 2048 px only when justified |
| Compressed texture memory target for visible scene | <= 128 MB | <= 256 MB |
| Unique material variants resident at once | <= 32 | <= 96 |
| Material slots on ordinary asset | <= 4 | <= 6 |
| Material slots on hero vehicle/robot/mech | <= 8 | <= 12 |
| Optional layers active per ordinary asset | <= 2 | <= 4 |
| Runtime AI/image-generation calls | 0 | 0 |
| Required fallback availability | one approved lower tier | one approved lower tier |

Implementation expectations:

- Prefer KTX2/Basis-style GPU-compressed delivery where the target browser
  supports it, with a documented fallback format.
- Pack ORM maps and atlas small decals when it reduces requests without causing
  visible bleeding.
- Stream materials by cell, distance, and asset importance rather than loading
  the full wasteland.
- Keep material selection client-side and deterministic; keep authoritative
  gameplay, inventory, construction, and combat state on the multiplayer
  server.
- Never make collision, hit detection, navigation, or game rules depend on a
  generated texture or a client-only visual decision.
- Use low-cost triplanar and layer variants only where profiling shows they fit
  the device budget. A beautiful mapping that causes mobile thermal or memory
  failure is not a shippable mapping.

## 12. Multiplayer and cross-device consistency

The server publishes an asset-manifest version and content hash. Network state
refers to stable asset IDs, part IDs, material IDs, variant IDs, and condition
parameters. It does not transmit prompts or ask each client to reinterpret an
object.

Clients may select a device tier, but all tiers must preserve:

- the same semantic parts and stable IDs;
- the same object transform and physical scale;
- the same material family and condition state;
- the same fallback ordering;
- the same collision and gameplay result.

An iPhone and an Android phone may render different resolutions or disable an
optional wetness layer, while a desktop may show a higher tier. That is a visual
quality difference, not a world-state difference. A late-joining client first
loads the manifest, then resolves the nearest approved tier before displaying
the object.

## 13. Agent responsibilities and review loop

The pipeline can be split into independent agent lanes, but the manifest is the
integration boundary:

- **Semantic agent** — recognizes the object, context, and candidate classes.
- **Decomposition agent** — proposes parts, slots, sockets, and mapping policy.
- **Material agent** — searches approved materials or writes a generation
  request when reuse is insufficient.
- **Normalization agent** — tiles, derives maps, checks scale, and records the
  transform log.
- **Runtime agent** — creates device tiers, streaming metadata, and fallback
  references.
- **Critic/validator agent** — checks semantic plausibility, scale, seams,
  lighting response, provenance, and budgets.
- **Integration agent** — accepts only manifest-valid outputs and preserves
  stable IDs across revisions.

Each iteration should:

1. inspect the object in Beauty and Inspection modes;
2. locate it by stable ID and grid address;
3. compare visible material parts with the semantic record;
4. run automated scale, seam, map, provenance, and budget checks;
5. record failures against the exact asset/part/material ID;
6. repair or replace the material and repeat until the release gates pass.

The critic must report observable evidence. “It feels fake” is valid feedback;
the follow-up should translate it into a likely cause such as wrong repeat
scale, uniform roughness, stretched normals, missing edge wear, or a material
family mismatch.

## 14. Release gates

An asset-to-material implementation is ready for a public build only when:

- every visible and collidable part has a stable ID and material slot;
- the semantic classification and confidence are recorded;
- every material is approved or has an explicit, reviewed fallback;
- generated material provenance is complete and contains no private metadata;
- source/license status is compatible with the intended public license;
- repeat distance and orientation are physically plausible;
- Beauty mode looks coherent at the target device tiers;
- Inspection mode exposes IDs, material slots, bounds, mapping, fallbacks, and
  validation issues;
- the asset resolves from the manifest with no runtime image-generation call;
- a clean client can load the same manifest version on desktop, iPhone, and
  Android without changing gameplay state.

The governing principle is simple: an AI should be able to create an object,
understand what it is, choose or make the surfaces it needs, place those
surfaces at believable scale, and leave behind a durable record that another AI,
developer, or multiplayer client can inspect later.
