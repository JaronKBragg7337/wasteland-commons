import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './world-state.mjs';
import { restoreWorld } from './restore.mjs';

test('restore rehydrates persisted entities and resumes deterministic ids', () => {
  const source = createWorld({ worldId: 'restore-test', worldSeed: 'restore-seed' });
  source.enqueue({ type: 'player.join', playerId: 'SURVIVOR-0004', position: { x: 2, y: 0.9, z: 3 } });
  source.enqueue({ type: 'construction.place', constructionId: 'construction-0007', blueprint: 'wall', position: { x: 8, y: 0, z: 8 } });
  source.step();
  const restored = restoreWorld(source.snapshot());
  assert.deepEqual(restored.snapshot(), source.snapshot());
  const next = restored.enqueue({ type: 'npc.spawn', role: 'grower' });
  assert.equal(next.accepted, true);
  restored.step();
  assert.equal(restored.snapshot().npcs[0].id, 'npc-0001');
});
