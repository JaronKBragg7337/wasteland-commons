import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { createWorld } from '../server/authoritative/world-state.mjs';
import { restoreWorld } from '../server/authoritative/restore.mjs';
import { createSceneSeedCommands } from '../server/scene-seed.mjs';
import { createSupabaseStore } from '../server/persistence/supabase-store.mjs';

const persistence = createSupabaseStore({ worldId: 'saltglass-basin' });
let world = createWorld({ worldId: 'saltglass-basin', worldSeed: 'saltglass-commons-001', rules: { playerSpeed: 7, sprintSpeed: 10 } });
const connections = new Map();
const palette = ['#7be6d0', '#ffbd69', '#c99cff', '#ff8f83'];

const persistedSnapshot = persistence.enabled ? await persistence.load().catch(() => null) : null;
if (persistedSnapshot) {
  world = restoreWorld(persistedSnapshot, { rules: { playerSpeed: 7, sprintSpeed: 10 } });
} else {
  world.state.settlement.resources = { food: 100, water: 100, power: 65, scrap: 120 };
  world.state.settlement.morale = 58;
  for (const command of createSceneSeedCommands()) world.enqueue(command);
}

const server = createServer((request, response) => {
  if (request.url === '/api/health' || request.url === '/health' || request.url === '/') {
    const current = world.snapshot();
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ name: 'Wasteland Commons Vercel relay', status: 'ready', protocol: current.schemaVersion, worldId: current.worldId, tick: current.tick, revision: current.revision, players: connections.size, persistence: persistence.enabled ? 'configured' : 'local-memory' }));
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
function broadcastSnapshot() {
  const current = snapshot();
  broadcast({ type: 'snapshot', snapshot: current });
  broadcast({ type: 'players', players: clientPlayers(current) });
}
function commandIdFor(message, prefix) { return String(message.commandId ?? `${prefix}-${randomUUID()}`); }

const simulationTimer = setInterval(() => {
  world.step();
  broadcastSnapshot();
  if (persistence.enabled && world.snapshot().tick % 100 === 0) persistence.persist(world.snapshot()).catch(() => {});
}, 1000 / 20);
simulationTimer.unref?.();

wss.on('connection', (socket) => {
  const playerId = `SURVIVOR-${randomUUID().slice(0, 8).toUpperCase()}`;
  const spawnIndex = connections.size;
  const position = { x: spawnIndex * 3 - 1.5, y: 0.9, z: 28 };
  connections.set(playerId, { socket, playerId });
  const accepted = world.enqueue({ type: 'player.join', commandId: `join-${playerId}`, playerId, name: `Survivor ${spawnIndex + 1}`, position });
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
    if (message.type === 'input') world.enqueue({ type: 'player.move', commandId: commandIdFor(message, 'move'), playerId, direction: message.direction ?? { x: 0, z: 0 }, sprint: Boolean(message.sprint) });
    else if (message.type === 'command' && message.command === 'build') world.enqueue({ type: 'construction.place', commandId: commandIdFor(message, 'build'), playerId, builderId: playerId, blueprint: 'foundation', position: message.record?.position ?? position, constructionId: message.record?.id });
    else if (message.type === 'command' && message.command === 'interact') world.enqueue({ type: 'player.interact', commandId: commandIdFor(message, 'interact'), playerId, recordId: message.recordId });
    else if (message.type === 'command' && message.command === 'attack') world.enqueue({ type: 'player.attack', commandId: commandIdFor(message, 'attack'), playerId, targetId: message.targetId, weapon: message.weapon ?? 'tool', range: message.range ?? 8 });
    else if (message.type === 'command' && message.command === 'enterVehicle') world.enqueue({ type: 'player.enterVehicle', commandId: commandIdFor(message, 'enter'), playerId, vehicleId: message.vehicleId });
    else if (message.type === 'command' && message.command === 'exitVehicle') world.enqueue({ type: 'player.exitVehicle', commandId: commandIdFor(message, 'exit'), playerId });
    else if (message.type === 'command' && message.command === 'boss.start') world.enqueue({ type: 'boss.start', commandId: commandIdFor(message, 'boss'), playerId, bossId: message.bossId, bossKey: message.bossKey, position: message.position });
    else if (message.type === 'command' && message.command === 'mech.pilot') world.enqueue({ type: 'mech.pilot', commandId: commandIdFor(message, 'mech-pilot'), playerId, mechId: message.mechId });
    else if (message.type === 'command' && message.command === 'mech.unpilot') world.enqueue({ type: 'mech.unpilot', commandId: commandIdFor(message, 'mech-unpilot'), playerId, mechId: message.mechId });
    else if (message.type === 'command' && message.command === 'mech.installModule') world.enqueue({ type: 'mech.installModule', commandId: commandIdFor(message, 'mech-install'), playerId, mechId: message.mechId, slot: message.slot, moduleKey: message.moduleKey });
    else if (message.type === 'command' && message.command === 'mech.activate') world.enqueue({ type: 'mech.activate', commandId: commandIdFor(message, 'mech-activate'), playerId, mechId: message.mechId, action: message.action, targetId: message.targetId });
    else if (message.type === 'ping') send(socket, { type: 'pong', at: Date.now(), tick: snapshot().tick });
  });
  socket.on('close', () => { connections.delete(playerId); world.enqueue({ type: 'player.leave', commandId: `leave-${playerId}-${snapshot().tick}`, playerId }); });
});

export default server;
