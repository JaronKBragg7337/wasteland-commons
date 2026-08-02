import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { createWorld } from '../server/authoritative/world-state.mjs';
import { restoreWorld } from '../server/authoritative/restore.mjs';
import { createSceneSeedCommands } from '../server/scene-seed.mjs';
import { createSupabaseStore } from '../server/persistence/supabase-store.mjs';
import { createSharedRoomCoordinator } from '../server/shared-room-coordinator.mjs';

const persistence = createSupabaseStore({ worldId: 'saltglass-basin' });
let world = createWorld({ worldId: 'saltglass-basin', worldSeed: 'saltglass-commons-001', rules: { playerSpeed: 7, sprintSpeed: 10 } });
const connections = new Map();
let pendingPersistenceEvents = [];
let lastQueuedPersistenceRevision = 0;
let persistenceTail = Promise.resolve();
const palette = ['#7be6d0', '#ffbd69', '#c99cff', '#ff8f83'];

function sharedCommand(command) {
  if (!command) return { accepted: false, reason: 'command is required' };
  if (!sharedRoom.enabled || sharedRoom.isLeader) return world.enqueue(command);
  void sharedRoom.publishCommand(command).catch((error) => console.error(`Shared command broadcast failed: ${error.message}`));
  return { accepted: true, queued: true, ...(command.commandId ? { commandId: command.commandId } : {}) };
}

function applySharedSnapshot(nextSnapshot) {
  if (!nextSnapshot || nextSnapshot.worldId !== 'saltglass-basin') return;
  if (Number(nextSnapshot.revision) <= Number(world.snapshot().revision)) return;
  world = restoreWorld(nextSnapshot, { rules: { playerSpeed: 7, sprintSpeed: 10 } });
  pendingPersistenceEvents = [];
  broadcastSnapshot(nextSnapshot);
}

const sharedRoom = createSharedRoomCoordinator({
  worldId: 'saltglass-basin',
  persistence,
  onCommand(command) {
    if (sharedRoom.isLeader) world.enqueue(command);
  },
  onSnapshot(nextSnapshot) {
    applySharedSnapshot(nextSnapshot);
  },
  onSnapshotRequest() {
    if (sharedRoom.isLeader) void sharedRoom.publishSnapshot(snapshot()).catch((error) => console.error(`Shared snapshot broadcast failed: ${error.message}`));
  },
  onLeadershipChange(isLeader) {
    if (!isLeader) return;
    const current = snapshot();
    broadcastSnapshot(current);
    void sharedRoom.publishSnapshot(current).catch((error) => console.error(`Shared snapshot broadcast failed: ${error.message}`));
  },
});

const persistedSnapshot = persistence.enabled ? await persistence.load() : null;
if (persistedSnapshot) {
  world = restoreWorld(persistedSnapshot, { rules: { playerSpeed: 7, sprintSpeed: 10 } });
} else {
  world.state.settlement.resources = { food: 100, water: 100, power: 65, scrap: 120 };
  world.state.settlement.morale = 58;
  for (const command of createSceneSeedCommands()) world.enqueue(command);
  if (persistence.enabled) await persistence.persist(world.snapshot(), { events: [] });
}

const server = createServer((request, response) => {
  if (request.url === '/api/health' || request.url === '/health' || request.url === '/') {
    const current = world.snapshot();
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      name: 'Wasteland Commons Vercel relay',
      status: 'ready',
      protocol: current.schemaVersion,
      worldId: current.worldId,
      tick: current.tick,
      revision: current.revision,
      players: connections.size,
      persistence: persistence.enabled ? 'configured' : 'local-memory',
      multiplayer: sharedRoom.enabled ? 'shared-realtime' : 'instance-local',
      authority: sharedRoom.enabled ? (sharedRoom.isLeader ? 'leader' : 'replica') : 'local',
    }));
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ error: 'not found' }));
});
const wss = new WebSocketServer({ server });

function snapshot() { return world.snapshot(); }
function clientPlayers(current) {
  return current.players.map((player, index) => ({ id: player.id, name: player.name, position: player.position, color: palette[index % palette.length], health: player.health, status: player.status, vehicleId: player.vehicleId }));
}
function send(socket, message) { if (socket.readyState === 1) socket.send(JSON.stringify(message)); }
function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const { socket } of connections.values()) if (socket.readyState === 1) socket.send(payload);
}
function broadcastSnapshot(current = snapshot()) {
  broadcast({ type: 'snapshot', snapshot: current });
  broadcast({ type: 'players', players: clientPlayers(current) });
}
function commandIdFor(message, prefix) { return String(message.commandId ?? `${prefix}-${randomUUID()}`); }

function queuePersistence(currentSnapshot) {
  if (!persistence.enabled || (sharedRoom.enabled && !sharedRoom.isLeader) || currentSnapshot.revision <= lastQueuedPersistenceRevision) return;
  const snapshotToPersist = structuredClone(currentSnapshot);
  const eventsToPersist = pendingPersistenceEvents.slice();
  lastQueuedPersistenceRevision = snapshotToPersist.revision;
  persistenceTail = persistenceTail.then(async () => {
    try {
      const result = await persistence.persist(snapshotToPersist, { events: eventsToPersist });
      if (!result.persisted) return;
      pendingPersistenceEvents.splice(0, eventsToPersist.length);
    } catch (error) {
      lastQueuedPersistenceRevision = 0;
      console.error(`Supabase persistence failed: ${error.message}`);
    }
  });
}

await sharedRoom.start();

const simulationTimer = setInterval(() => {
  if (sharedRoom.enabled && !sharedRoom.isLeader) return;
  world.step();
  const current = snapshot();
  if (persistence.enabled) pendingPersistenceEvents.push(...current.events);
  broadcastSnapshot(current);
  if (sharedRoom.enabled && current.tick % 2 === 0) void sharedRoom.publishSnapshot(current).catch((error) => console.error(`Shared snapshot broadcast failed: ${error.message}`));
  if (current.tick % 100 === 0) queuePersistence(current);
}, 1000 / 20);
simulationTimer.unref?.();

wss.on('connection', (socket) => {
  const playerId = `SURVIVOR-${randomUUID().slice(0, 8).toUpperCase()}`;
  const spawnIndex = connections.size;
  const position = { x: spawnIndex * 3 - 1.5, y: 0.9, z: 28 };
  connections.set(playerId, { socket, playerId });
  const accepted = sharedCommand({ type: 'player.join', commandId: `join-${playerId}`, playerId, name: `Survivor ${spawnIndex + 1}`, position });
  if (!accepted.accepted) {
    send(socket, { type: 'error', reason: accepted.reason });
    socket.close(1013, 'world capacity unavailable');
    connections.delete(playerId);
    return;
  }
  send(socket, { type: 'welcome', playerId, players: clientPlayers(snapshot()), snapshot: snapshot(), worldSeed: 'saltglass-commons-001' });
  socket.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.type === 'input') sharedCommand({ type: 'player.move', commandId: commandIdFor(message, 'move'), playerId, direction: message.direction ?? { x: 0, z: 0 }, sprint: Boolean(message.sprint) });
    else if (message.type === 'command' && message.command === 'build') sharedCommand({ type: 'construction.place', commandId: commandIdFor(message, 'build'), playerId, builderId: playerId, blueprint: 'foundation', position: message.record?.position ?? position, constructionId: message.record?.id });
    else if (message.type === 'command' && message.command === 'interact') sharedCommand({ type: 'player.interact', commandId: commandIdFor(message, 'interact'), playerId, recordId: message.recordId });
    else if (message.type === 'command' && message.command === 'attack') sharedCommand({ type: 'player.attack', commandId: commandIdFor(message, 'attack'), playerId, targetId: message.targetId, weapon: message.weapon ?? 'tool', range: message.range ?? 8 });
    else if (message.type === 'command' && message.command === 'enterVehicle') sharedCommand({ type: 'player.enterVehicle', commandId: commandIdFor(message, 'enter'), playerId, vehicleId: message.vehicleId });
    else if (message.type === 'command' && message.command === 'exitVehicle') sharedCommand({ type: 'player.exitVehicle', commandId: commandIdFor(message, 'exit'), playerId });
    else if (message.type === 'command' && message.command === 'boss.start') sharedCommand({ type: 'boss.start', commandId: commandIdFor(message, 'boss'), playerId, bossId: message.bossId, bossKey: message.bossKey, position: message.position });
    else if (message.type === 'command' && message.command === 'mech.pilot') sharedCommand({ type: 'mech.pilot', commandId: commandIdFor(message, 'mech-pilot'), playerId, mechId: message.mechId });
    else if (message.type === 'command' && message.command === 'mech.unpilot') sharedCommand({ type: 'mech.unpilot', commandId: commandIdFor(message, 'mech-unpilot'), playerId, mechId: message.mechId });
    else if (message.type === 'command' && message.command === 'mech.installModule') sharedCommand({ type: 'mech.installModule', commandId: commandIdFor(message, 'mech-install'), playerId, mechId: message.mechId, slot: message.slot, moduleKey: message.moduleKey });
    else if (message.type === 'command' && message.command === 'mech.activate') sharedCommand({ type: 'mech.activate', commandId: commandIdFor(message, 'mech-activate'), playerId, mechId: message.mechId, action: message.action, targetId: message.targetId });
    else if (message.type === 'ping') send(socket, { type: 'pong', at: Date.now(), tick: snapshot().tick });
  });
  socket.on('close', () => { connections.delete(playerId); sharedCommand({ type: 'player.leave', commandId: `leave-${playerId}-${snapshot().tick}`, playerId }); });
});

export default server;
