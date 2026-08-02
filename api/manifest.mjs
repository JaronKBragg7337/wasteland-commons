import { createHash } from 'node:crypto';
import grid from '../world/grid.json' with { type: 'json' };
import manifest from '../world/manifest.json' with { type: 'json' };
import materials from '../world/asset-materials.json' with { type: 'json' };

const release = 'saltglass-basin-2026-08-02';

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export default function manifestHandler(_request, response) {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'public, max-age=60');
  response.statusCode = 200;
  response.end(JSON.stringify({
    service: 'wasteland-commons',
    release,
    license: 'CC0-1.0',
    scene: {
      id: manifest.sceneId,
      name: manifest.name,
      seed: manifest.seed,
      recordCount: manifest.records.length,
      sizeMeters: {
        x: grid.sceneBounds.max.x - grid.sceneBounds.min.x,
        z: grid.sceneBounds.max.z - grid.sceneBounds.min.z,
      },
      grid: {
        cellSizeMeters: grid.cellSize,
        levelHeightMeters: grid.levelHeight,
        origin: grid.origin,
        bounds: grid.sceneBounds,
      },
      manifestHash: sha256(manifest),
      gridHash: sha256(grid),
      materialsHash: sha256(materials),
    },
    records: manifest.records,
    materials: materials.materials,
  }));
}
