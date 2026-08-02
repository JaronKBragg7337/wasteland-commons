import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './world-state.mjs';

function send(world, command) {
  const result = world.enqueue(command);
  assert.equal(result.accepted, true, `command was not queued: ${JSON.stringify(result)}`);
  return result;
}

function byId(snapshot, collection, id) {
  const entity = snapshot[collection].find((candidate) => candidate.id === id);
  assert.ok(entity, `${collection} did not contain ${id}`);
  return entity;
}

test('fixed steps and snapshots are deterministic for the same command stream', () => {
  const makeWorld = () => createWorld({ worldId: 'test-world', worldSeed: 'seed-7' });
  const first = makeWorld();
  const second = makeWorld();
  const commands = [
    { type: 'player.join', playerId: 'p1', name: 'Rook', position: { x: 0, y: 0.9, z: 0 } },
    { type: 'player.move', playerId: 'p1', direction: { x: 1, z: 0 }, sprint: true },
    { type: 'npc.spawn', npcId: 'n1', role: 'grower' },
    { type: 'robot.spawn', robotId: 'r1', disposition: 'hostile', position: { x: 5, y: 0, z: 0 } },
    { type: 'undead.spawn', undeadId: 'u1', kind: 'runner', position: { x: -5, y: 0, z: 0 } },
  ];
  for (const command of commands) {
    send(first, command);
    send(second, command);
  }
  first.step(20);
  second.step(20);
  assert.deepEqual(first.snapshot(), second.snapshot());
  assert.equal(first.snapshot().tick, 20);
  assert.deepEqual(first.snapshot().bounds, { minX: -160, maxX: 160, minZ: -128, maxZ: 128 });
  assert.equal(first.snapshot().worldContract.gridCellSizeMeters, 4);
  assert.doesNotThrow(() => JSON.parse(first.serializeSnapshot()));
});

test('player intent moves only during fixed steps and respects world bounds', () => {
  const world = createWorld({ rules: { bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 } } });
  send(world, { type: 'player.join', playerId: 'p1', position: { x: 0, y: 0, z: 0 } });
  world.step();
  send(world, { type: 'player.move', playerId: 'p1', direction: { x: 1, z: 0 } });
  const before = byId(world.snapshot(), 'players', 'p1').position.x;
  world.step();
  const after = byId(world.snapshot(), 'players', 'p1').position.x;
  assert.equal(before, 0);
  assert.equal(after, 0.15);
  world.step(100);
  assert.equal(byId(world.snapshot(), 'players', 'p1').position.x, 1);
});

test('entities, vehicle authority, construction, and NPC production are authoritative', () => {
  const world = createWorld({ rules: { jobIntervalTicks: 20 } });
  send(world, { type: 'player.join', playerId: 'p1', position: { x: 0, y: 0, z: 0 } });
  send(world, { type: 'npc.spawn', npcId: 'builder-1', role: 'builder' });
  send(world, { type: 'npc.spawn', npcId: 'grower-1', role: 'grower' });
  send(world, { type: 'vehicle.spawn', vehicleId: 'truck-1', kind: 'cargo', position: { x: 0, y: 0, z: 0 } });
  send(world, { type: 'construction.place', constructionId: 'wall-1', blueprint: 'wall', position: { x: 3.2, y: 0, z: 2.7 }, builderId: 'builder-1' });
  world.step();
  send(world, { type: 'player.enterVehicle', playerId: 'p1', vehicleId: 'truck-1' });
  world.step();
  send(world, { type: 'vehicle.drive', playerId: 'p1', vehicleId: 'truck-1', direction: { x: 1, z: 0 } });
  world.step(2);
  const snapshot = world.snapshot();
  assert.equal(byId(snapshot, 'vehicles', 'truck-1').driverId, 'p1');
  assert.equal(byId(snapshot, 'vehicles', 'truck-1').position.x, 0.4);
  assert.equal(byId(snapshot, 'constructions', 'wall-1').position.x, 4);
  assert.equal(byId(snapshot, 'constructions', 'wall-1').position.z, 4);
  world.step(8);
  assert.equal(byId(world.snapshot(), 'constructions', 'wall-1').status, 'complete');
  world.step(9);
  assert.equal(byId(world.snapshot(), 'npcs', 'grower-1').output, 1);
  assert.equal(world.snapshot().settlement.resources.food, 23);
});

test('player construction is range-gated while trusted world commands remain valid', () => {
  const world = createWorld();
  send(world, { type: 'player.join', playerId: 'builder-player', position: { x: 0, y: 0.9, z: 0 } });

  const trusted = world.enqueue({
    type: 'construction.place', constructionId: 'trusted-wall', blueprint: 'wall',
    position: { x: 20, y: 0, z: 20 }
  });
  assert.equal(trusted.accepted, true);
  world.step();

  const farPlayerRequest = world.enqueue({
    type: 'construction.place', commandId: 'far-build', playerId: 'builder-player',
    constructionId: 'far-wall', blueprint: 'wall', position: { x: 40, y: 0, z: 40 }
  });
  assert.equal(farPlayerRequest.accepted, true);
  world.step();
  assert.equal(world.snapshot().constructions.some((construction) => construction.id === 'far-wall'), false);
  assert.equal(world.snapshot().events.at(-1).reason, 'construction site is out of reach');

  const nearPlayerRequest = world.enqueue({
    type: 'construction.place', commandId: 'near-build', playerId: 'builder-player',
    constructionId: 'near-wall', blueprint: 'wall', position: { x: 4, y: 0, z: 4 }
  });
  assert.equal(nearPlayerRequest.accepted, true);
  world.step();
  assert.equal(world.snapshot().constructions.some((construction) => construction.id === 'near-wall'), true);
});

test('NPC production uses a deliberate settlement cadence instead of draining each second', () => {
  const world = createWorld();
  send(world, { type: 'npc.spawn', npcId: 'grower-1', role: 'grower' });
  world.step(20);
  assert.equal(byId(world.snapshot(), 'npcs', 'grower-1').output, 0);
  assert.equal(world.snapshot().settlement.resources.water, 20);
  world.step(180);
  assert.equal(byId(world.snapshot(), 'npcs', 'grower-1').output, 1);
  assert.equal(world.snapshot().settlement.resources.food, 23);
  assert.equal(world.snapshot().settlement.resources.water, 19);
});

test('hostile AI, buried undead, damage, boss phases, and defeat are deterministic', () => {
  const world = createWorld();
  send(world, { type: 'player.join', playerId: 'p1', position: { x: 0, y: 0, z: 0 } });
  send(world, { type: 'robot.spawn', robotId: 'enemy-1', disposition: 'hostile', position: { x: 2, y: 0, z: 0 } });
  send(world, { type: 'undead.spawn', undeadId: 'buried-1', kind: 'buried', position: { x: 3, y: 0, z: 0 } });
  send(world, { type: 'boss.start', bossId: 'warden-1', bossKey: 'relay-warden', position: { x: 4, y: 0, z: 0 } });
  world.step();
  assert.equal(byId(world.snapshot(), 'undead', 'buried-1').status, 'active');
  assert.equal(byId(world.snapshot(), 'bosses', 'warden-1').phase, 1);
  let sawDamage = false;
  for (let index = 0; index < 30; index += 1) {
    send(world, { type: 'player.attack', playerId: 'p1', targetId: 'warden-1', weapon: 'shotgun' });
    world.step();
    sawDamage ||= world.snapshot().events.some((event) => event.type === 'damage.applied');
  }
  const boss = byId(world.snapshot(), 'bosses', 'warden-1');
  assert.equal(boss.status, 'defeated');
  assert.equal(boss.health, 0);
  assert.equal(sawDamage, true);
});

test('mech modules change the serializable mech contract and gate actions', () => {
  const world = createWorld();
  send(world, { type: 'mech.create', mechId: 'mech-1', position: { x: 0, y: 0, z: 0 } });
  send(world, { type: 'mech.installModule', mechId: 'mech-1', slot: 'core', moduleKey: 'core-capacitor' });
  send(world, { type: 'mech.installModule', mechId: 'mech-1', slot: 'utility', moduleKey: 'sensor-array' });
  world.step();
  const mech = byId(world.snapshot(), 'mechs', 'mech-1');
  assert.equal(mech.modules.core.moduleKey, 'core-capacitor');
  assert.equal(mech.modules.utility.moduleKey, 'sensor-array');
  assert.equal(mech.energyMax, 80);
  send(world, { type: 'mech.activate', mechId: 'mech-1', action: 'scan' });
  world.step();
  assert.equal(world.snapshot().events.at(-1).type, 'mech.activated');
  send(world, { type: 'mech.activate', mechId: 'mech-1', action: 'attack' });
  world.step();
  assert.equal(world.snapshot().events.at(-1).type, 'command.rejected');
});

test('invalid commands are rejected without mutating authoritative entities', () => {
  const world = createWorld();
  assert.deepEqual(world.enqueue({ type: 'not-real' }), { accepted: false, reason: 'unknown command type: not-real' });
  send(world, { type: 'player.join', playerId: 'p1' });
  world.step();
  const before = world.snapshot();
  send(world, { type: 'vehicle.drive', playerId: 'p1', vehicleId: 'missing', direction: { x: 1, z: 0 } });
  world.step();
  const after = world.snapshot();
  assert.deepEqual(after.players, before.players);
  assert.equal(after.events[0].type, 'command.rejected');
});

test('command IDs deduplicate retried side effects and reject conflicting reuse', () => {
  const world = createWorld();
  const command = {
    type: 'construction.place',
    commandId: 'build-request-1',
    constructionId: 'wall-1',
    blueprint: 'wall',
    position: { x: 3.2, y: 0, z: 2.7 },
  };
  const first = send(world, command);
  const retry = world.enqueue({ ...command });
  assert.deepEqual(retry, { ...first, duplicate: true, commandId: 'build-request-1' });
  const conflict = world.enqueue({ ...command, blueprint: 'foundation' });
  assert.deepEqual(conflict, {
    accepted: false,
    reason: 'commandId is already used for a different command',
    commandId: 'build-request-1',
  });
  send(world, {
    ...command,
    commandId: 'build-request-2',
  });

  world.step();
  const snapshot = world.snapshot();
  assert.equal(snapshot.constructions.length, 1);
  assert.equal(snapshot.constructions[0].position.y, 0.8);
  assert.equal(snapshot.settlement.resources.scrap, 56);
  assert.equal(snapshot.events[0].commandId, 'build-request-1');
});

test('snapshot metadata is deterministic and supports reconnect reconciliation', () => {
  const makeWorld = () => createWorld({ worldId: 'reconnect-world', worldSeed: 'seed-8' });
  const first = makeWorld();
  const second = makeWorld();
  const join = {
    type: 'player.join',
    commandId: 'join-request-1',
    playerId: 'p1',
    name: 'Rook',
    position: { x: 0, y: 0.9, z: 0 },
  };
  const firstAck = send(first, join);
  send(second, join);
  first.step();
  second.step();

  const firstSnapshot = first.snapshot();
  const secondSnapshot = second.snapshot();
  assert.deepEqual(firstSnapshot, secondSnapshot);
  assert.equal(firstSnapshot.snapshotId, 'reconnect-world:1');
  assert.equal(firstSnapshot.lastProcessedCommandSequence, firstAck.sequence);
  assert.equal(firstSnapshot.events[0].eventId, '1:001');
  assert.equal(firstSnapshot.events[0].commandId, 'join-request-1');
  assert.deepEqual(JSON.parse(first.serializeSnapshot()), firstSnapshot);

  const reconnectRetry = first.enqueue({ ...join });
  assert.deepEqual(reconnectRetry, { ...firstAck, duplicate: true, commandId: 'join-request-1' });
  first.step();
  assert.equal(first.snapshot().players.length, 1);
});

test('dedupe retention is bounded and expires deterministically', () => {
  const world = createWorld({ rules: { commandDedupeTicks: 2, commandDedupeMaxEntries: 3 } });
  const first = send(world, { type: 'player.join', commandId: 'join-1', playerId: 'p1' });
  send(world, { type: 'npc.spawn', commandId: 'spawn-1', npcId: 'n1' });
  send(world, { type: 'robot.spawn', commandId: 'spawn-2', robotId: 'r1' });
  assert.equal(world.enqueue({ type: 'player.join', commandId: 'join-1', playerId: 'p1' }).duplicate, true);
  world.step(3);
  const expired = world.enqueue({ type: 'player.join', commandId: 'join-1', playerId: 'p1' });
  assert.equal(expired.accepted, true);
  assert.notEqual(expired.sequence, first.sequence);
  assert.equal(world.snapshot().players.length, 1);
});

test('mech pilot and unpilot commands enforce range, occupancy, and follow movement', () => {
  const world = createWorld();
  send(world, { type: 'player.join', playerId: 'p1', position: { x: 0, y: 0, z: 0 } });
  send(world, { type: 'player.join', playerId: 'p2', position: { x: 0, y: 0, z: 0 } });
  send(world, { type: 'mech.create', mechId: 'mech-1', position: { x: 0, y: 0, z: 0 } });
  send(world, { type: 'mech.create', mechId: 'mech-2', position: { x: 20, y: 0, z: 0 } });
  world.step();

  const pilot = send(world, {
    type: 'mech.pilot', commandId: 'pilot-mech-1', playerId: 'p1', mechId: 'mech-1',
  });
  assert.deepEqual(world.enqueue({
    type: 'mech.pilot', commandId: 'pilot-mech-1', playerId: 'p1', mechId: 'mech-1',
  }), { ...pilot, duplicate: true, commandId: 'pilot-mech-1' });
  send(world, { type: 'mech.pilot', playerId: 'p2', mechId: 'mech-1' });
  send(world, { type: 'mech.pilot', playerId: 'p2', mechId: 'mech-2' });
  world.step();

  let snapshot = world.snapshot();
  assert.equal(byId(snapshot, 'players', 'p1').mechId, 'mech-1');
  assert.equal(byId(snapshot, 'mechs', 'mech-1').pilotId, 'p1');
  assert.equal(byId(snapshot, 'mechs', 'mech-1').status, 'piloted');
  assert.ok(snapshot.events.some((event) => event.reason === 'mech is already occupied'));
  assert.ok(snapshot.events.some((event) => event.reason === 'mech is out of reach'));

  send(world, { type: 'player.move', playerId: 'p1', direction: { x: 1, z: 0 } });
  world.step();
  snapshot = world.snapshot();
  assert.equal(byId(snapshot, 'mechs', 'mech-1').position.x, 0.15);
  assert.equal(byId(snapshot, 'players', 'p1').position.x, 0.15);
  assert.deepEqual(byId(snapshot, 'players', 'p1').position, byId(snapshot, 'mechs', 'mech-1').position);

  send(world, { type: 'mech.unpilot', playerId: 'p2', mechId: 'mech-1' });
  send(world, { type: 'mech.unpilot', playerId: 'p1', mechId: 'mech-1' });
  world.step();
  snapshot = world.snapshot();
  assert.equal(byId(snapshot, 'players', 'p1').mechId, null);
  assert.equal(byId(snapshot, 'mechs', 'mech-1').pilotId, null);
  assert.equal(byId(snapshot, 'mechs', 'mech-1').status, 'parked');
  assert.equal(byId(snapshot, 'players', 'p1').position.x, 1.65);
  assert.ok(snapshot.events.some((event) => event.reason === 'player is not piloting a mech'));
  assert.ok(snapshot.events.some((event) => event.type === 'mech.unpiloted'));
});

test('player movement drives only the boarded vehicle driver and passengers follow', () => {
  const world = createWorld();
  send(world, { type: 'player.join', playerId: 'driver', position: { x: 0, y: 0, z: 0 } });
  send(world, { type: 'player.join', playerId: 'passenger', position: { x: 0, y: 0, z: 0 } });
  send(world, { type: 'vehicle.spawn', vehicleId: 'cargo-1', kind: 'cargo', position: { x: 0, y: 0, z: 0 } });
  world.step();

  send(world, { type: 'player.enterVehicle', playerId: 'driver', vehicleId: 'cargo-1' });
  send(world, { type: 'player.enterVehicle', playerId: 'passenger', vehicleId: 'cargo-1' });
  world.step();
  assert.equal(byId(world.snapshot(), 'vehicles', 'cargo-1').driverId, 'driver');
  assert.deepEqual(byId(world.snapshot(), 'vehicles', 'cargo-1').passengerIds, ['passenger']);

  send(world, { type: 'player.move', playerId: 'driver', direction: { x: 1, z: 0 } });
  world.step(2);
  let snapshot = world.snapshot();
  assert.equal(byId(snapshot, 'vehicles', 'cargo-1').position.x, 0.4);
  assert.equal(byId(snapshot, 'players', 'driver').position.x, 0.4);
  assert.equal(byId(snapshot, 'players', 'passenger').position.x, 0.4);

  send(world, { type: 'player.move', playerId: 'passenger', direction: { x: 0, z: 1 } });
  world.step();
  snapshot = world.snapshot();
  assert.equal(byId(snapshot, 'vehicles', 'cargo-1').position.x, 0.6);
  assert.equal(byId(snapshot, 'vehicles', 'cargo-1').position.z, 0);
  assert.equal(byId(snapshot, 'players', 'passenger').position.x, 0.6);
  assert.equal(byId(snapshot, 'players', 'passenger').position.z, 0);
});
