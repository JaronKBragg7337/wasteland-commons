import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { createWorld } from './authoritative/world-state.mjs';
import { restoreWorld } from './authoritative/restore.mjs';
import { createSceneSeedCommands } from './scene-seed.mjs';
import { createSupabaseStore } from './persistence/supabase-store.mjs';

const port = Number(process.env.PORT ?? 8787);
let world = createWorld({
  worldId: 'saltglass-basin',
  worldSeed: 'saltglass-commons-001',
  rules: { playerSpeed: 7, sprintSpeed: 10 }
});
const connections = new Map();
const persistence = createSupabaseStore({ worldId: 'saltglass-basin' });
let pendingPersistenceEvents = [];
let lastQueuedPersistenceRevision = 0;
let persistenceTail = Promise.resolve();
const palette = ['#7be6d0', '#ffbd69', '#c99cff', '#ff8f83'];
const server = createServer((request, response) => {
  if (request.url === '/health' || request.url === '/') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    const current = world.snapshot();
    response.end(JSON.stringify({
      name: 'Wasteland Commons authoritative relay',
      status: 'ready',
      protocol: current.schemaVersion,
      worldId: current.worldId,
      tick: current.tick,
      revision: current.revision,
      players: connections.size,
      persistence: persistence.enabled ? 'configured' : 'local-memory',
    }));
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ error: 'not found' }));
});
const wss = new WebSocketServer({ server });

function snapshot() {
  return world.snapshot();
}

function clientPlayers(currentSnapshot) {
  return currentSnapshot.players.map((player, index) => ({
    id: player.id,
    name: player.name,
    position: player.position,
    color: palette[index % palette.length],
    health: player.health,
    status: player.status,
  }));
}

function send(socket, message) {
  if (socket.readyState === 1) socket.send(JSON.stringify(message));
}

function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const { socket } of connections.values()) if (socket.readyState === 1) socket.send(payload);
}

function broadcastSnapshot(currentSnapshot = snapshot()) {
  broadcast({ type: 'snapshot', snapshot: currentSnapshot });
  broadcast({ type: 'players', players: clientPlayers(currentSnapshot) });
}

function queuePersistence(currentSnapshot) {
  if (!persistence.enabled || currentSnapshot.revision <= lastQueuedPersistenceRevision) return;
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

function enqueue(command) {
  return world.enqueue(command);
}

function commandIdFor(message, prefix) {
  return String(message.commandId ?? `${prefix}-${randomUUID()}`);
}

const persistedSnapshot = persistence.enabled ? await persistence.load() : null;
if (persistedSnapshot) {
  world = restoreWorld(persistedSnapshot, { rules: { playerSpeed: 7, sprintSpeed: 10 } });
  console.log(`Restored Saltglass Basin at revision ${world.snapshot().revision}`);
} else {
  world.state.settlement.resources = { food: 100, water: 100, power: 65, scrap: 120 };
  world.state.settlement.morale = 58;
  for (const command of createSceneSeedCommands()) enqueue(command);
}

const simulationTimer = setInterval(() => {
  world.step();
  const currentSnapshot = snapshot();
  if (persistence.enabled) pendingPersistenceEvents.push(...currentSnapshot.events);
  broadcastSnapshot(currentSnapshot);
  if (currentSnapshot.tick % 100 === 0) queuePersistence(currentSnapshot);
}, 1000 / 20);
simulationTimer.unref();

wss.on('connection', (socket) => {
  const playerId = `SURVIVOR-${randomUUID().slice(0, 8).toUpperCase()}`;
  const spawnIndex = connections.size;
  const position = { x: spawnIndex * 3 - 1.5, y: 0.9, z: 28 };
  const player = { socket, playerId };
  connections.set(playerId, player);
  const accepted = enqueue({
    type: 'player.join',
    playerId,
    name: `Survivor ${spawnIndex + 1}`,
    position,
  });
  if (!accepted.accepted) {
    send(socket, { type: 'error', reason: accepted.reason });
    socket.close(1013, 'world capacity unavailable');
    connections.delete(playerId);
    return;
  }
  send(socket, {
    type: 'welcome',
    playerId,
    players: clientPlayers(snapshot()),
    snapshot: snapshot(),
    worldSeed: 'saltglass-commons-001',
  });

  socket.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.type === 'input') {
      enqueue({
        type: 'player.move',
        commandId: commandIdFor(message, 'move'),
        playerId,
        direction: message.direction ?? { x: 0, z: 0 },
        sprint: Boolean(message.sprint),
      });
    } else if (message.type === 'command' && message.command === 'build') {
      enqueue({
        type: 'construction.place',
        commandId: commandIdFor(message, 'build'),
        playerId,
        builderId: playerId,
        blueprint: 'foundation',
        position: message.record?.position ?? position,
        constructionId: message.record?.id,
      });
    } else if (message.type === 'command' && message.command === 'attack') {
      enqueue({
        type: 'player.attack',
        commandId: commandIdFor(message, 'attack'),
        playerId,
        targetId: message.targetId,
        weapon: message.weapon ?? 'tool',
        range: message.range ?? 8,
      });
    } else if (message.type === 'command' && message.command === 'interact') {
      enqueue({ type: 'player.interact', commandId: commandIdFor(message, 'interact'), playerId, recordId: message.recordId });
    } else if (message.type === 'command' && message.command === 'enterVehicle') {
      enqueue({ type: 'player.enterVehicle', commandId: commandIdFor(message, 'enter'), playerId, vehicleId: message.vehicleId });
    } else if (message.type === 'command' && message.command === 'exitVehicle') {
      enqueue({ type: 'player.exitVehicle', commandId: commandIdFor(message, 'exit'), playerId });
    } else if (message.type === 'command' && message.command === 'boss.start') {
      enqueue({
        type: 'boss.start',
        commandId: commandIdFor(message, 'boss'),
        playerId,
        bossId: message.bossId,
        bossKey: message.bossKey,
        position: message.position,
      });
    } else if (message.type === 'command' && message.command === 'mech.pilot') {
      enqueue({
        type: 'mech.pilot',
        commandId: commandIdFor(message, 'mech-pilot'),
        playerId,
        mechId: message.mechId,
      });
    } else if (message.type === 'command' && message.command === 'mech.unpilot') {
      enqueue({
        type: 'mech.unpilot',
        commandId: commandIdFor(message, 'mech-unpilot'),
        playerId,
        mechId: message.mechId,
      });
    } else if (message.type === 'command' && message.command === 'mech.installModule') {
      enqueue({
        type: 'mech.installModule',
        commandId: commandIdFor(message, 'mech-install'),
        playerId,
        mechId: message.mechId,
        slot: message.slot,
        moduleKey: message.moduleKey,
      });
    } else if (message.type === 'command' && message.command === 'mech.activate') {
      enqueue({
        type: 'mech.activate',
        commandId: commandIdFor(message, 'mech-activate'),
        playerId,
        mechId: message.mechId,
        action: message.action,
        targetId: message.targetId,
      });
    } else if (message.type === 'ping') {
      send(socket, { type: 'pong', at: Date.now(), tick: snapshot().tick });
    }
  });

  socket.on('close', () => {
    connections.delete(playerId);
    enqueue({ type: 'player.leave', playerId });
  });
});

server.listen(port, () => console.log(`Wasteland Commons authoritative relay listening on http://localhost:${port}`));
