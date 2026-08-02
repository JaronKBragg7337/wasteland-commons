import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneSeedCommands } from './scene-seed.mjs';

test('scene seed is deterministic and covers the live ecosystem', () => {
  const first = createSceneSeedCommands();
  const second = createSceneSeedCommands();
  assert.deepEqual(first, second);
  assert.ok(first.some((command) => command.type === 'robot.spawn' && command.disposition === 'hostile'));
  assert.ok(first.some((command) => command.type === 'robot.spawn' && command.disposition === 'helpful'));
  assert.ok(first.some((command) => command.type === 'robot.spawn' && command.disposition === 'neutral'));
  assert.ok(first.some((command) => command.type === 'undead.spawn'));
  assert.ok(first.some((command) => command.type === 'undead.spawn' && command.kind === 'runner'));
  assert.ok(first.some((command) => command.type === 'vehicle.spawn' && command.kind === 'cargo'));
  assert.equal(first.filter((command) => command.type === 'npc.spawn').length, 6);
});
