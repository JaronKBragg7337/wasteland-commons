import grid from '../world/grid.json' with { type: 'json' };
import manifest from '../world/manifest.json' with { type: 'json' };
import { supabaseConfigured } from '../server/persistence/supabase-config.mjs';

const release = 'saltglass-basin-2026-08-02';
const sharedBackendConfigured = supabaseConfigured();

export default function healthHandler(_request, response) {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.statusCode = 200;
  response.end(JSON.stringify({
    service: 'wasteland-commons',
    status: 'ready',
    release,
    websocketPath: '/api/ws',
    world: {
      sceneId: manifest.sceneId,
      recordCount: manifest.records.length,
      sizeMeters: {
        x: grid.sceneBounds.max.x - grid.sceneBounds.min.x,
        z: grid.sceneBounds.max.z - grid.sceneBounds.min.z,
      },
      gridCellSizeMeters: grid.cellSize,
    },
    multiplayer: sharedBackendConfigured ? 'shared-realtime-configured' : 'instance-local-until-shared-relay-is-configured',
    persistence: sharedBackendConfigured ? 'dedicated-supabase-configured' : 'local-memory-until-dedicated-supabase-is-configured',
    publicReleaseGate: sharedBackendConfigured ? 'runtime-verification-required' : 'shared-multiplayer-pending',
  }));
}
