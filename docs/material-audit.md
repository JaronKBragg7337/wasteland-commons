# Material and asset provenance audit

`tools/material-audit.mjs` is a read-only audit for the material inputs used by
Wasteland Commons. It reads:

- `world/manifest.json` for the material keys used by world records;
- `world/asset-materials.json` for catalog entries, image paths, and provenance;
- `public/assets/materials/` for the image files and their on-disk byte sizes.

The utility does not rewrite, normalize, hash, or otherwise modify any of these
inputs.

## Run it

From the project root:

```sh
node tools/material-audit.mjs
```

Use `--json` for a machine-readable report, or `--strict` to make warnings
(including unused catalog keys and incomplete provenance fields) fail the
command:

```sh
node tools/material-audit.mjs --json
node tools/material-audit.mjs --strict
```

The default command exits non-zero for missing files or manifest material keys
that are absent from the catalog. An audit with only warnings exits zero so the
current catalog can intentionally contain a shared or future-facing material.

## What it reports

The audit compares material keys in both directions:

- **Missing catalog keys** are keys used by `materialKey` or `materialParts`
  that do not exist under `asset-materials.json.materials`.
- **Untracked material keys** are catalog keys that are not used by any
  manifest record. This catches stale entries as well as shared materials that
  have not yet been connected to the world manifest.
- **Missing files** are catalog `file` paths that cannot be resolved to an
  existing file below `public/assets/`.
- **Untracked image files** are image files below `public/assets/materials/`
  that are not named by a catalog entry.
- **Image byte sizes** list every catalog image and the complete image directory
  inventory. Bytes are filesystem sizes, not decoded texture memory.
- **Provenance gaps** identify catalog entries missing a `source` or `prompt`
  field.

Catalog paths are expected to use the public URL form, such as
`/assets/materials/rusted-steel.png`. The resolver rejects paths that leave the
`public/` directory.

## Mobile budget summary

The summary uses the mobile baselines in `docs/material-pipeline.md`:

| Check | Baseline | Audit value |
| --- | ---: | --- |
| Tracked material image bytes | 128 MiB visible-scene texture target | Sum of unique existing catalog image files; disk-byte proxy |
| Unique referenced material variants | 32 | Distinct keys used by manifest records |
| Ordinary-asset material slots | 4 | Largest distinct `materialKey`/`materialParts` set on a non-hero record |
| Hero vehicle/robot/mech slots | 8 | Largest distinct material set on a vehicle, robot, or mech record |
| Runtime AI/image-generation calls | 0 | Static audit assumption; runtime behavior is not inferred |
| Initial playable load | 20 MB compressed code/core-scene target | Not evaluated because this audit only scans material inputs |

The image-byte check is intentionally labeled a proxy. PNG or other source-file
bytes do not equal compressed GPU residency, and the real texture budget still
requires device profiling and runtime streaming checks.
