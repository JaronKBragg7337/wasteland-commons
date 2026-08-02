import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './world-state.mjs';

test('settlement interactions are authoritative and range-gated', () => {
  const world = createWorld();
  world.enqueue({ type: 'player.join', playerId: 'p1', position: { x: -64, y: 0.9, z: -24 } });
  world.step();
  const before = world.snapshot().settlement;
  world.enqueue({ type: 'player.interact', playerId: 'p1', recordId: 'RELAY-TOWER-0001' });
  world.step();
  const after = world.snapshot().settlement;
  assert.equal(after.systems.signal, true);
  assert.equal(after.morale, before.morale + 5);
  assert.equal(after.resources.power, before.resources.power + 10);

  world.enqueue({ type: 'player.interact', playerId: 'p1', recordId: 'WATER-CISTERN-0001' });
  world.step();
  assert.equal(world.snapshot().events.at(-1).type, 'command.rejected');
});
