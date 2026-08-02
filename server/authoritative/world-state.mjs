import { createHash } from 'node:crypto';
import grid from '../../world/grid.json' with { type: 'json' };
import manifest from '../../world/manifest.json' with { type: 'json' };

const WORLD_BOUNDS = Object.freeze({
  minX: grid.sceneBounds.min.x,
  maxX: grid.sceneBounds.max.x,
  minZ: grid.sceneBounds.min.z,
  maxZ: grid.sceneBounds.max.z,
});
const WORLD_MANIFEST = new Map(manifest.records.map((record) => [record.id, record]));
const WORLD_MANIFEST_HASH = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');

const STATIC_INTERACTIONS = Object.freeze({
  'RELAY-TOWER-0001': { system: 'signal', power: 10, morale: 5 },
  'WATER-CISTERN-0001': { water: 20 },
  'COMMUNITY-GARDEN-0001': { food: 10, morale: 2 },
  'ROBOT-FRIENDLY-0001': { morale: 4 },
  'ROBOT-TRADER-0001': { morale: 4, scrap: 4 },
});

function interactionFor(recordId) {
  const record = WORLD_MANIFEST.get(recordId);
  if (!record) return null;
  if (STATIC_INTERACTIONS[recordId]) return { record, ...STATIC_INTERACTIONS[recordId] };
  const semanticType = String(record.semanticType ?? '').toLowerCase();
  if (record.category === 'robot' && semanticType.includes('friendly')) return { record, morale: 4 };
  if (semanticType.includes('water') || semanticType.includes('cistern') || semanticType.includes('purifier')) return { record, water: 15 };
  if (semanticType.includes('garden') || semanticType.includes('farm') || semanticType.includes('food')) return { record, food: 8, morale: 1 };
  if (semanticType.includes('outpost') || semanticType.includes('beacon')) return { record, power: 3, morale: 2 };
  if (semanticType.includes('signal') || semanticType.includes('relay') || semanticType.includes('terminal')) return { record, system: 'signal', power: 5 };
  if (semanticType.includes('generator') || semanticType.includes('fabricator') || semanticType.includes('workshop')) return { record, power: 8, scrap: 2 };
  if (semanticType.includes('salvage') || semanticType.includes('depot') || semanticType.includes('ruin')) return { record, scrap: 6 };
  return null;
}

const DEFAULT_RULES = Object.freeze({
  tickRate: 20,
  commandDedupeTicks: 12_000,
  commandDedupeMaxEntries: 50_000,
  bounds: WORLD_BOUNDS,
  gridSize: grid.cellSize,
  maxPlayers: 4,
  playerSpeed: 3,
  sprintSpeed: 5,
  mechPilotRange: 4,
  vehicleSpeed: Object.freeze({ scout: 6, cargo: 4 }),
  construction: Object.freeze({
    foundation: Object.freeze({ buildTicks: 20, cost: Object.freeze({ scrap: 8, power: 0 }) }),
    wall: Object.freeze({ buildTicks: 10, cost: Object.freeze({ scrap: 4, power: 0 }) }),
    storage: Object.freeze({ buildTicks: 18, cost: Object.freeze({ scrap: 10, power: 2 }) }),
    workshop: Object.freeze({ buildTicks: 24, cost: Object.freeze({ scrap: 14, power: 5 }) }),
    watchPost: Object.freeze({ buildTicks: 16, cost: Object.freeze({ scrap: 12, power: 3 }) }),
  }),
});

const MODULES = Object.freeze({
  'core-capacitor': { slot: 'core', energyMax: 30, heatCapacity: 100 },
  'core-coolant': { slot: 'core', energyMax: 10, heatCapacity: 150 },
  'heavy-legs': { slot: 'locomotion', speed: 2.5, armor: 15 },
  'light-legs': { slot: 'locomotion', speed: 4, armor: 5 },
  shield: { slot: 'left-arm', armor: 25, action: 'shield' },
  grabber: { slot: 'left-arm', action: 'grab' },
  'repair-tool': { slot: 'left-arm', action: 'repair' },
  'impact-tool': { slot: 'right-arm', damage: 18, action: 'attack' },
  'ranged-weapon': { slot: 'right-arm', damage: 12, action: 'attack' },
  'disable-tool': { slot: 'right-arm', damage: 8, action: 'disable' },
  'cargo-rig': { slot: 'utility', cargo: 12 },
  'repair-drone': { slot: 'utility', action: 'repair' },
  'sensor-array': { slot: 'utility', action: 'scan' },
  'emergency-power': { slot: 'utility', energyMax: 20 },
});

const BLUEPRINTS = new Set(Object.keys(DEFAULT_RULES.construction));
const KNOWN_COMMANDS = new Set([
  'player.join', 'player.leave', 'player.move', 'player.attack', 'player.interact',
  'player.enterVehicle', 'player.exitVehicle',
  'npc.spawn', 'npc.assign', 'robot.spawn', 'undead.spawn',
  'vehicle.spawn', 'vehicle.drive',
  'construction.place', 'mech.create', 'mech.installModule', 'mech.activate',
  'mech.pilot', 'mech.unpilot',
  'boss.start',
]);

function clone(value) {
  return structuredClone(value);
}

function stableSerialize(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'bigint') return `bigint:${value.toString()}`;
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function commandIdOf(command) {
  const commandValue = command.commandId;
  const aliasValue = command.idempotencyKey;
  if (commandValue !== undefined && aliasValue !== undefined && String(commandValue).trim() !== String(aliasValue).trim()) {
    return { error: 'commandId and idempotencyKey must match' };
  }
  const value = commandValue ?? aliasValue;
  if (value === undefined || value === null) return { id: null };
  const id = String(value).trim();
  if (!id) return { error: 'commandId must not be empty' };
  if (id.length > 128) return { error: 'commandId must be 128 characters or fewer' };
  return { id };
}

function commandFingerprint(command) {
  const comparable = {};
  for (const key of Object.keys(command).sort()) {
    if (key === 'commandId' || key === 'idempotencyKey' || key === 'tick') continue;
    comparable[key] = command[key];
  }
  return stableSerialize(comparable);
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function integer(value, fallback = 0) {
  const number = finite(value, fallback);
  return Number.isInteger(number) ? number : Math.trunc(number);
}

function quantize(value) {
  return Math.round(finite(value) * 1000) / 1000;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function positionOf(value = {}) {
  return { x: quantize(value.x), y: quantize(value.y), z: quantize(value.z) };
}

function horizontalDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function unitDirection(from, to) {
  const x = to.x - from.x;
  const z = to.z - from.z;
  const length = Math.hypot(x, z);
  return length ? { x: x / length, z: z / length } : { x: 0, z: 0 };
}

function normalizeDirection(value = {}) {
  const x = finite(value.x);
  const z = finite(value.z);
  const length = Math.hypot(x, z);
  return length ? { x: x / length, z: z / length } : { x: 0, z: 0 };
}

function sortedValues(map) {
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id)).map(clone);
}

function idPart(value, fallback) {
  const text = String(value ?? fallback).trim();
  return text.replace(/[^a-zA-Z0-9:_-]/g, '-').slice(0, 48) || fallback;
}

export class WorldState {
  constructor(options = {}) {
    const rules = options.rules ?? {};
    this.rules = {
      ...DEFAULT_RULES,
      ...rules,
      commandDedupeTicks: Math.max(1, integer(rules.commandDedupeTicks, DEFAULT_RULES.commandDedupeTicks)),
      commandDedupeMaxEntries: Math.max(1, integer(rules.commandDedupeMaxEntries, DEFAULT_RULES.commandDedupeMaxEntries)),
      bounds: { ...DEFAULT_RULES.bounds, ...(rules.bounds ?? {}) },
      vehicleSpeed: { ...DEFAULT_RULES.vehicleSpeed, ...(rules.vehicleSpeed ?? {}) },
      construction: { ...DEFAULT_RULES.construction, ...(rules.construction ?? {}) },
    };
    this.worldId = idPart(options.worldId, 'wasteland-commons');
    this.worldSeed = String(options.worldSeed ?? 'saltglass-commons-001');
    this.state = {
      tick: 0,
      revision: 0,
      nextCommandSequence: 1,
      lastProcessedCommandSequence: 0,
      nextIds: { player: 1, npc: 1, robot: 1, undead: 1, vehicle: 1, construction: 1, mech: 1, module: 1, boss: 1 },
      queuedCommands: new Map(),
      commandDedupe: new Map(),
      events: [],
      players: new Map(),
      npcs: new Map(),
      robots: new Map(),
      undead: new Map(),
      vehicles: new Map(),
      constructions: new Map(),
      mechs: new Map(),
      bosses: new Map(),
      settlement: {
        resources: { food: 20, water: 20, power: 20, scrap: 60 },
        morale: 58,
        systems: { water: false, signal: false, fabrication: false },
      },
    };
  }

  nextId(kind) {
    const number = this.state.nextIds[kind]++;
    return `${kind}-${String(number).padStart(4, '0')}`;
  }

  requestedId(kind, supplied) {
    if (supplied === undefined || supplied === null || String(supplied).trim() === '') return this.nextId(kind);
    return idPart(supplied, `${kind}-provided`);
  }

  enqueue(command = {}) {
    if (!command || typeof command !== 'object' || Array.isArray(command)) {
      return { accepted: false, reason: 'command must be an object' };
    }
    if (!KNOWN_COMMANDS.has(command.type)) {
      return { accepted: false, reason: `unknown command type: ${String(command.type)}` };
    }
    const commandIdentity = commandIdOf(command);
    if (commandIdentity.error) return { accepted: false, reason: commandIdentity.error };
    const commandId = commandIdentity.id;
    const fingerprint = commandId ? commandFingerprint(command) : null;
    this.#pruneCommandDedupe();
    if (commandId) {
      const existing = this.state.commandDedupe.get(commandId);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          return { accepted: false, reason: 'commandId is already used for a different command', commandId };
        }
        return { ...clone(existing.ack), duplicate: true };
      }
    }
    const tick = command.tick === undefined ? this.state.tick + 1 : integer(command.tick, -1);
    if (tick <= this.state.tick) return { accepted: false, reason: 'command tick must be in the future' };
    if (tick > this.state.tick + 600) return { accepted: false, reason: 'command is too far in the future' };
    const sequence = this.state.nextCommandSequence++;
    const queued = { ...clone(command), ...(commandId ? { commandId } : {}), tick, sequence };
    const commands = this.state.queuedCommands.get(tick) ?? [];
    commands.push(queued);
    this.state.queuedCommands.set(tick, commands);
    const acknowledgement = { accepted: true, tick, sequence, ...(commandId ? { commandId } : {}) };
    if (commandId) {
      this.state.commandDedupe.set(commandId, {
        fingerprint,
        ack: acknowledgement,
        expiresAtTick: this.state.tick + this.rules.commandDedupeTicks,
      });
      this.#pruneCommandDedupe();
    }
    return acknowledgement;
  }

  command(command) {
    return this.enqueue(command);
  }

  step(steps = 1) {
    const count = integer(steps, 1);
    if (count < 0 || count > 10_000) throw new RangeError('steps must be between 0 and 10000');
    for (let index = 0; index < count; index += 1) this.#stepOnce();
    return this.snapshot();
  }

  snapshot() {
    const snapshot = {
      schemaVersion: 'wasteland-authoritative/1',
      snapshotId: `${this.worldId}:${this.state.revision}`,
      worldId: this.worldId,
      worldSeed: this.worldSeed,
      worldContract: {
        sceneId: manifest.sceneId,
        manifestHash: WORLD_MANIFEST_HASH,
        manifestRecordCount: manifest.records.length,
        gridCellSizeMeters: grid.cellSize,
      },
      tickRate: this.rules.tickRate,
      tick: this.state.tick,
      revision: this.state.revision,
      lastProcessedCommandSequence: this.state.lastProcessedCommandSequence,
      bounds: clone(this.rules.bounds),
      settlement: clone(this.state.settlement),
      players: sortedValues(this.state.players),
      npcs: sortedValues(this.state.npcs),
      robots: sortedValues(this.state.robots),
      undead: sortedValues(this.state.undead),
      vehicles: sortedValues(this.state.vehicles),
      constructions: sortedValues(this.state.constructions),
      mechs: sortedValues(this.state.mechs),
      bosses: sortedValues(this.state.bosses),
      events: clone(this.state.events),
    };
    return clone(snapshot);
  }

  serializeSnapshot() {
    return JSON.stringify(this.snapshot());
  }

  #stepOnce() {
    const tick = this.state.tick + 1;
    this.state.tick = tick;
    this.state.events = [];
    const commands = this.state.queuedCommands.get(tick) ?? [];
    this.state.queuedCommands.delete(tick);
    commands.sort((a, b) => a.sequence - b.sequence);
    for (const command of commands) {
      this.state.lastProcessedCommandSequence = command.sequence;
      this.#applyCommand(command);
    }
    this.#simulatePlayers();
    this.#simulateVehicles();
    this.#simulateConstruction();
    this.#simulateNpcJobs();
    this.#simulateRobots();
    this.#simulateUndead();
    this.#simulateMechs();
    this.#simulateBosses();
    this.state.revision += 1;
    this.#pruneCommandDedupe();
  }

  #event(type, data = {}) {
    const event = {
      type,
      tick: this.state.tick,
      ...clone(data),
      eventId: `${this.state.tick}:${String(this.state.events.length + 1).padStart(3, '0')}`,
    };
    const command = this.state.activeCommand;
    if (command) {
      event.commandSequence = command.sequence;
      if (command.commandId) event.commandId = command.commandId;
    }
    this.state.events.push(event);
  }

  #reject(command, reason) {
    this.#event('command.rejected', {
      sequence: command.sequence,
      commandType: command.type,
      ...(command.commandId ? { commandId: command.commandId } : {}),
      reason,
    });
  }

  #applyCommand(command) {
    const handler = {
      'player.join': () => this.#joinPlayer(command),
      'player.leave': () => this.#leavePlayer(command),
      'player.move': () => this.#movePlayer(command),
      'player.attack': () => this.#playerAttack(command),
      'player.interact': () => this.#playerInteract(command),
      'player.enterVehicle': () => this.#enterVehicle(command),
      'player.exitVehicle': () => this.#exitVehicle(command),
      'npc.spawn': () => this.#spawnNpc(command),
      'npc.assign': () => this.#assignNpc(command),
      'robot.spawn': () => this.#spawnRobot(command),
      'undead.spawn': () => this.#spawnUndead(command),
      'vehicle.spawn': () => this.#spawnVehicle(command),
      'vehicle.drive': () => this.#driveVehicle(command),
      'construction.place': () => this.#placeConstruction(command),
      'mech.create': () => this.#createMech(command),
      'mech.installModule': () => this.#installModule(command),
      'mech.activate': () => this.#activateMech(command),
      'mech.pilot': () => this.#pilotMech(command),
      'mech.unpilot': () => this.#unpilotMech(command),
      'boss.start': () => this.#startBoss(command),
    }[command.type];
    this.state.activeCommand = command;
    try {
      handler();
    } finally {
      this.state.activeCommand = null;
    }
  }

  #joinPlayer(command) {
    if (this.state.players.size >= this.rules.maxPlayers) return this.#reject(command, 'player limit reached');
    const id = this.requestedId('player', command.playerId);
    if (this.state.players.has(id)) return this.#reject(command, 'player id already exists');
    const position = this.#clampPosition(positionOf(command.position ?? { x: 0, y: 0.9, z: 16 }));
    this.state.players.set(id, {
      id,
      name: String(command.name ?? id),
      position,
      velocity: { x: 0, y: 0, z: 0 },
      health: 100,
      maxHealth: 100,
      stamina: 100,
      input: { x: 0, z: 0, sprint: false },
      vehicleId: null,
      mechId: null,
      lastCommandSequence: command.sequence,
      status: 'active',
    });
    this.#event('player.joined', { playerId: id });
  }

  #leavePlayer(command) {
    const player = this.state.players.get(command.playerId);
    if (!player) return this.#reject(command, 'player not found');
    if (player.vehicleId) this.#removePassenger(player.vehicleId, player.id);
    if (player.mechId) this.#releaseMechPilot(this.state.mechs.get(player.mechId), { placePlayer: false });
    this.state.players.delete(player.id);
    this.#event('player.left', { playerId: player.id });
  }

  #movePlayer(command) {
    const player = this.state.players.get(command.playerId);
    if (!player) return this.#reject(command, 'player not found');
    player.input = { ...normalizeDirection(command.direction), sprint: Boolean(command.sprint) };
    player.lastCommandSequence = command.sequence;
    if (player.vehicleId) {
      const vehicle = this.state.vehicles.get(player.vehicleId);
      if (vehicle?.driverId === player.id && vehicle.status === 'active') {
        vehicle.input = normalizeDirection(player.input);
        vehicle.lastDriverCommand = command.sequence;
      }
    }
    if (player.mechId) {
      const mech = this.state.mechs.get(player.mechId);
      if (mech?.pilotId === player.id && mech.status !== 'disabled') {
        mech.input = normalizeDirection(player.input);
      }
    }
  }

  #playerInteract(command) {
    const player = this.state.players.get(command.playerId);
    if (!player || player.status !== 'active') return this.#reject(command, 'active player not found');
    const interaction = interactionFor(command.recordId);
    const effects = interaction ? { ...interaction, position: interaction.record.position } : null;
    if (!effects) return this.#reject(command, 'record is not interactable');
    if (horizontalDistance(player.position, effects.position) > 9) return this.#reject(command, 'record out of reach');
    const resources = this.state.settlement.resources;
    for (const [resource, amount] of Object.entries(effects)) {
      if (resource === 'record' || resource === 'position' || resource === 'system' || resource === 'morale') continue;
      resources[resource] = Math.max(0, quantize((resources[resource] ?? 0) + amount));
    }
    if (effects.morale) this.state.settlement.morale = clamp(quantize(Number(this.state.settlement.morale ?? 58) + effects.morale), 0, 100);
    if (effects.system) this.state.settlement.systems[effects.system] = true;
    this.#event('settlement.interacted', { playerId: player.id, recordId: command.recordId });
  }

  #playerAttack(command) {
    const player = this.state.players.get(command.playerId);
    if (!player || player.status !== 'active') return this.#reject(command, 'active player not found');
    const target = this.#findTarget(command.targetId);
    if (!target || target.status === 'destroyed' || target.status === 'dead' || target.status === 'defeated') {
      return this.#reject(command, 'target not found or inactive');
    }
    if (horizontalDistance(player.position, target.position) > finite(command.range, 8)) {
      return this.#reject(command, 'target out of range');
    }
    const damageByWeapon = { tool: 8, rifle: 15, shotgun: 22, mech: 18 };
    const damage = damageByWeapon[command.weapon] ?? 10;
    this.#damage(target, damage, player.id);
  }

  #enterVehicle(command) {
    const player = this.state.players.get(command.playerId);
    const vehicle = this.state.vehicles.get(command.vehicleId);
    if (!player || !vehicle) return this.#reject(command, 'player or vehicle not found');
    if (player.vehicleId) return this.#reject(command, 'player is already in a vehicle');
    if (player.mechId) return this.#reject(command, 'player is piloting a mech');
    if (vehicle.status === 'disabled') return this.#reject(command, 'vehicle is disabled');
    if (horizontalDistance(player.position, vehicle.position) > 4) return this.#reject(command, 'vehicle is out of reach');
    if (vehicle.driverId === null) vehicle.driverId = player.id;
    else if (!vehicle.passengerIds.includes(player.id)) vehicle.passengerIds.push(player.id);
    player.vehicleId = vehicle.id;
    player.position = clone(vehicle.position);
    this.#event('vehicle.boarded', { playerId: player.id, vehicleId: vehicle.id });
  }

  #exitVehicle(command) {
    const player = this.state.players.get(command.playerId);
    if (!player?.vehicleId) return this.#reject(command, 'player is not in a vehicle');
    const vehicle = this.state.vehicles.get(player.vehicleId);
    this.#removePassenger(player.vehicleId, player.id);
    if (vehicle) player.position = this.#clampPosition({ ...vehicle.position, x: vehicle.position.x + 1.5 });
    player.vehicleId = null;
    this.#event('vehicle.exited', { playerId: player.id, vehicleId: vehicle?.id ?? null });
  }

  #spawnNpc(command) {
    const id = this.requestedId('npc', command.npcId);
    if (this.state.npcs.has(id)) return this.#reject(command, 'npc id already exists');
    const roles = new Set(['grower', 'scavenger', 'mechanic', 'medic', 'builder', 'guard']);
    const role = roles.has(command.role) ? command.role : 'scavenger';
    this.state.npcs.set(id, {
      id, name: String(command.name ?? id), role, position: positionOf(command.position),
      health: 100, maxHealth: 100, status: 'working', output: 0,
    });
    this.#event('npc.spawned', { npcId: id, role });
  }

  #assignNpc(command) {
    const npc = this.state.npcs.get(command.npcId);
    const roles = new Set(['grower', 'scavenger', 'mechanic', 'medic', 'builder', 'guard']);
    if (!npc) return this.#reject(command, 'npc not found');
    if (!roles.has(command.role)) return this.#reject(command, 'unknown npc role');
    npc.role = command.role;
    npc.status = 'working';
    this.#event('npc.assigned', { npcId: npc.id, role: npc.role });
  }

  #spawnRobot(command) {
    const id = this.requestedId('robot', command.robotId);
    if (this.state.robots.has(id)) return this.#reject(command, 'robot id already exists');
    const disposition = new Set(['helpful', 'neutral', 'hostile']).has(command.disposition) ? command.disposition : 'neutral';
    this.state.robots.set(id, {
      id, model: String(command.model ?? 'utility'), disposition, position: positionOf(command.position),
      health: 60, maxHealth: 60, status: 'active', targetId: null, attackCooldown: 0,
    });
    this.#event('robot.spawned', { robotId: id, disposition });
  }

  #spawnUndead(command) {
    const id = this.requestedId('undead', command.undeadId);
    if (this.state.undead.has(id)) return this.#reject(command, 'undead id already exists');
    const kind = new Set(['drifter', 'runner', 'buried']).has(command.kind) ? command.kind : 'drifter';
    this.state.undead.set(id, {
      id, kind, position: positionOf(command.position), health: kind === 'runner' ? 25 : 40,
      maxHealth: kind === 'runner' ? 25 : 40, status: kind === 'buried' ? 'buried' : 'active',
      attackCooldown: 0, targetId: null,
    });
    this.#event('undead.spawned', { undeadId: id, kind });
  }

  #spawnVehicle(command) {
    const id = this.requestedId('vehicle', command.vehicleId);
    if (this.state.vehicles.has(id)) return this.#reject(command, 'vehicle id already exists');
    const kind = command.kind === 'cargo' ? 'cargo' : 'scout';
    this.state.vehicles.set(id, {
      id, kind, position: this.#clampPosition(positionOf(command.position)),
      health: kind === 'cargo' ? 140 : 90, maxHealth: kind === 'cargo' ? 140 : 90,
      fuel: 100, status: 'active', driverId: null, passengerIds: [],
      input: { x: 0, z: 0 }, lastDriverCommand: null,
    });
    this.#event('vehicle.spawned', { vehicleId: id, kind });
  }

  #driveVehicle(command) {
    const vehicle = this.state.vehicles.get(command.vehicleId);
    if (!vehicle) return this.#reject(command, 'vehicle not found');
    if (!vehicle.driverId || vehicle.driverId !== command.playerId) return this.#reject(command, 'driver authority required');
    vehicle.input = normalizeDirection(command.direction);
    vehicle.lastDriverCommand = command.sequence;
  }

  #pilotMech(command) {
    const player = this.state.players.get(command.playerId);
    const mech = this.state.mechs.get(command.mechId);
    if (!player || player.status !== 'active') return this.#reject(command, 'active player not found');
    if (!mech) return this.#reject(command, 'mech not found');
    if (player.vehicleId) return this.#reject(command, 'player is in a vehicle');
    if (player.mechId) return this.#reject(command, 'player is already piloting a mech');
    if (mech.pilotId) return this.#reject(command, 'mech is already occupied');
    if (mech.status === 'disabled') return this.#reject(command, 'mech is disabled');
    if (mech.status === 'overheated') return this.#reject(command, 'mech is overheated');
    if (horizontalDistance(player.position, mech.position) > this.rules.mechPilotRange) {
      return this.#reject(command, 'mech is out of reach');
    }
    mech.pilotId = player.id;
    mech.status = 'piloted';
    mech.input = { x: 0, z: 0 };
    player.mechId = mech.id;
    player.position = clone(mech.position);
    player.velocity = { x: 0, y: 0, z: 0 };
    player.input = { x: 0, z: 0, sprint: false };
    this.#event('mech.piloted', { mechId: mech.id, playerId: player.id });
  }

  #unpilotMech(command) {
    const player = this.state.players.get(command.playerId);
    if (!player || player.status !== 'active') return this.#reject(command, 'active player not found');
    if (!player.mechId) return this.#reject(command, 'player is not piloting a mech');
    if (command.mechId !== undefined && command.mechId !== player.mechId) {
      return this.#reject(command, 'player is piloting a different mech');
    }
    const mech = this.state.mechs.get(player.mechId);
    if (!mech) return this.#reject(command, 'mech not found');
    if (mech.pilotId !== player.id) return this.#reject(command, 'mech occupancy mismatch');
    const mechId = mech.id;
    this.#releaseMechPilot(mech);
    this.#event('mech.unpiloted', { mechId, playerId: player.id });
  }

  #placeConstruction(command) {
    const blueprint = this.rules.construction[command.blueprint];
    if (!blueprint || !BLUEPRINTS.has(command.blueprint)) return this.#reject(command, 'unknown construction blueprint');
    const position = this.#snapPosition(command.position);
    if (!this.#insideBounds(position)) return this.#reject(command, 'construction is outside world bounds');
    const id = this.requestedId('construction', command.constructionId);
    if (this.state.constructions.has(id)) return this.#reject(command, 'construction id already exists');
    for (const existing of this.state.constructions.values()) {
      if (existing.status !== 'complete' && horizontalDistance(existing.position, position) < this.rules.gridSize) {
        return this.#reject(command, 'construction cell is occupied');
      }
    }
    for (const [resource, cost] of Object.entries(blueprint.cost ?? {})) {
      if ((this.state.settlement.resources[resource] ?? 0) < cost) return this.#reject(command, `insufficient ${resource}`);
    }
    for (const [resource, cost] of Object.entries(blueprint.cost ?? {})) this.state.settlement.resources[resource] -= cost;
    this.state.constructions.set(id, {
      id, blueprint: command.blueprint, position, status: 'building', progress: 0,
      buildTicks: integer(blueprint.buildTicks, 1), builderId: command.builderId ?? null,
    });
    this.#event('construction.placed', { constructionId: id, blueprint: command.blueprint });
  }

  #createMech(command) {
    const id = this.requestedId('mech', command.mechId);
    if (this.state.mechs.has(id)) return this.#reject(command, 'mech id already exists');
    this.state.mechs.set(id, {
      id, chassis: String(command.chassis ?? 'commons-01'), position: this.#clampPosition(positionOf(command.position)),
      status: 'parked', pilotId: null, health: 250, maxHealth: 250,
      energy: 50, energyMax: 50, heat: 0, heatCapacity: 100, action: null,
      input: { x: 0, z: 0 }, modules: {},
    });
    this.#event('mech.created', { mechId: id });
  }

  #installModule(command) {
    const mech = this.state.mechs.get(command.mechId);
    const module = MODULES[command.moduleKey];
    if (!mech) return this.#reject(command, 'mech not found');
    if (command.playerId && mech.pilotId !== command.playerId) return this.#reject(command, 'pilot authority required');
    if (!module) return this.#reject(command, 'unknown mech module');
    if (module.slot !== command.slot) return this.#reject(command, 'module does not fit slot');
    mech.modules[command.slot] = {
      id: this.nextId('module'), slot: command.slot, moduleKey: command.moduleKey, durability: 100,
    };
    this.#recalculateMech(mech);
    this.#event('mech.moduleInstalled', { mechId: mech.id, slot: command.slot, moduleKey: command.moduleKey });
  }

  #activateMech(command) {
    const mech = this.state.mechs.get(command.mechId);
    if (!mech) return this.#reject(command, 'mech not found');
    if (command.playerId && mech.pilotId !== command.playerId) return this.#reject(command, 'pilot authority required');
    if (mech.status === 'disabled') return this.#reject(command, 'mech is disabled');
    const action = String(command.action ?? 'scan');
    const allowed = new Set(Object.values(mech.modules).map((entry) => MODULES[entry.moduleKey]?.action).filter(Boolean));
    if (!allowed.has(action)) return this.#reject(command, 'installed modules cannot perform action');
    if (mech.energy < 5) return this.#reject(command, 'mech lacks energy');
    mech.energy -= 5;
    mech.heat += action === 'attack' ? 12 : 5;
    mech.action = { action, tick: this.state.tick, targetId: command.targetId ?? null };
    if (action === 'repair' && command.targetId) {
      const target = this.#findTarget(command.targetId);
      if (target && 'health' in target) target.health = Math.min(target.maxHealth, target.health + 12);
    }
    if (action === 'disable' && command.targetId) {
      const target = this.#findTarget(command.targetId);
      if (target?.disposition === 'hostile') target.status = 'disabled';
    }
    if (action === 'attack' && command.targetId) {
      const target = this.#findTarget(command.targetId);
      if (target) this.#damage(target, MODULES[mech.modules['right-arm']?.moduleKey]?.damage ?? 10, mech.id);
    }
    this.#event('mech.activated', { mechId: mech.id, action, targetId: command.targetId ?? null });
  }

  #startBoss(command) {
    const bossKey = new Set(['relay-warden', 'foundry-giant']).has(command.bossKey) ? command.bossKey : null;
    if (!bossKey) return this.#reject(command, 'unknown boss encounter');
    if ([...this.state.bosses.values()].some((boss) => boss.status === 'active')) return this.#reject(command, 'another boss is active');
    const id = this.requestedId('boss', command.bossId);
    if (this.state.bosses.has(id)) return this.#reject(command, 'boss id already exists');
    const health = bossKey === 'foundry-giant' ? 500 : 300;
    this.state.bosses.set(id, {
      id, bossKey, position: positionOf(command.position), health, maxHealth: health,
      phase: 1, status: 'active', attackCooldown: 0, targetId: null,
    });
    this.#event('boss.started', { bossId: id, bossKey });
  }

  #findTarget(targetId) {
    for (const collection of [this.state.players, this.state.robots, this.state.undead, this.state.vehicles, this.state.mechs, this.state.bosses]) {
      if (collection.has(targetId)) return collection.get(targetId);
    }
    return null;
  }

  #damage(target, amount, sourceId) {
    const armor = target.armor ?? 0;
    const actual = Math.max(1, Math.round(finite(amount, 1) * (100 / (100 + armor))));
    target.health = Math.max(0, quantize(target.health - actual));
    if (target.health === 0) {
      if (this.state.robots.has(target.id)) target.status = 'destroyed';
      else if (this.state.undead.has(target.id)) target.status = 'dead';
      else if (this.state.bosses.has(target.id)) target.status = 'defeated';
      else if (this.state.vehicles.has(target.id)) target.status = 'disabled';
      else if (this.state.mechs.has(target.id)) {
        target.status = 'disabled';
        this.#releaseMechPilot(target);
      }
      else target.status = 'downed';
    }
    this.#event('damage.applied', { targetId: target.id, sourceId, amount: actual, health: target.health });
  }

  #simulatePlayers() {
    const dt = 1 / this.rules.tickRate;
    for (const player of this.state.players.values()) {
      if (player.status !== 'active') continue;
      if (player.mechId) {
        const mech = this.state.mechs.get(player.mechId);
        if (!mech || mech.pilotId !== player.id) {
          player.mechId = null;
          player.velocity = { x: 0, y: 0, z: 0 };
          continue;
        }
        const direction = normalizeDirection(player.input);
        mech.input = direction;
        const canMove = mech.status !== 'disabled' && mech.status !== 'overheated';
        const speed = this.#mechMovementSpeed(mech);
        player.velocity = { x: quantize(canMove ? direction.x * speed : 0), y: 0, z: quantize(canMove ? direction.z * speed : 0) };
        if (canMove) {
          mech.position.x = quantize(clamp(mech.position.x + player.velocity.x * dt, this.rules.bounds.minX, this.rules.bounds.maxX));
          mech.position.z = quantize(clamp(mech.position.z + player.velocity.z * dt, this.rules.bounds.minZ, this.rules.bounds.maxZ));
        }
        player.position = clone(mech.position);
        player.stamina = quantize(Math.min(100, player.stamina + 5 * dt));
        continue;
      }
      if (player.vehicleId) continue;
      const speed = player.input.sprint && player.stamina > 0 ? this.rules.sprintSpeed : this.rules.playerSpeed;
      const direction = normalizeDirection(player.input);
      player.velocity = { x: quantize(direction.x * speed), y: 0, z: quantize(direction.z * speed) };
      player.position.x = quantize(clamp(player.position.x + player.velocity.x * dt, this.rules.bounds.minX, this.rules.bounds.maxX));
      player.position.z = quantize(clamp(player.position.z + player.velocity.z * dt, this.rules.bounds.minZ, this.rules.bounds.maxZ));
      player.stamina = quantize(player.input.sprint && (direction.x || direction.z) ? Math.max(0, player.stamina - 10 * dt) : Math.min(100, player.stamina + 5 * dt));
    }
  }

  #simulateVehicles() {
    const dt = 1 / this.rules.tickRate;
    for (const vehicle of this.state.vehicles.values()) {
      if (vehicle.status !== 'active' || !vehicle.driverId || vehicle.fuel <= 0) continue;
      const direction = normalizeDirection(vehicle.input);
      const speed = this.rules.vehicleSpeed[vehicle.kind] ?? 4;
      vehicle.position.x = quantize(clamp(vehicle.position.x + direction.x * speed * dt, this.rules.bounds.minX, this.rules.bounds.maxX));
      vehicle.position.z = quantize(clamp(vehicle.position.z + direction.z * speed * dt, this.rules.bounds.minZ, this.rules.bounds.maxZ));
      vehicle.fuel = quantize(Math.max(0, vehicle.fuel - (direction.x || direction.z ? 0.2 : 0)));
      for (const player of this.state.players.values()) if (player.vehicleId === vehicle.id) player.position = clone(vehicle.position);
    }
  }

  #simulateConstruction() {
    const builderCount = [...this.state.npcs.values()].filter((npc) => npc.role === 'builder' && npc.status === 'working').length;
    for (const construction of this.state.constructions.values()) {
      if (construction.status !== 'building') continue;
      construction.progress += 1 + builderCount;
      if (construction.progress >= construction.buildTicks) {
        construction.progress = construction.buildTicks;
        construction.status = 'complete';
        this.#event('construction.completed', { constructionId: construction.id, blueprint: construction.blueprint });
      }
    }
  }

  #simulateNpcJobs() {
    if (this.state.tick % this.rules.tickRate !== 0) return;
    for (const npc of this.state.npcs.values()) {
      if (npc.status !== 'working') continue;
      const output = { grower: { food: 3, water: -1 }, scavenger: { scrap: 2 }, mechanic: { power: -1 }, guard: {}, builder: {}, medic: {} }[npc.role] ?? {};
      for (const [resource, amount] of Object.entries(output)) this.state.settlement.resources[resource] = Math.max(0, (this.state.settlement.resources[resource] ?? 0) + amount);
      npc.output += 1;
    }
  }

  #simulateRobots() {
    const dt = 1 / this.rules.tickRate;
    for (const robot of this.state.robots.values()) {
      if (robot.status !== 'active' || robot.disposition !== 'hostile') continue;
      const target = this.#nearestPlayer(robot.position);
      if (!target) continue;
      robot.targetId = target.id;
      const distance = horizontalDistance(robot.position, target.position);
      if (distance > 1.5) {
        const direction = unitDirection(robot.position, target.position);
        robot.position.x = quantize(robot.position.x + direction.x * 1.5 * dt);
        robot.position.z = quantize(robot.position.z + direction.z * 1.5 * dt);
      } else if (robot.attackCooldown === 0) {
        this.#damage(target, 5, robot.id);
        robot.attackCooldown = 10;
      }
      robot.attackCooldown = Math.max(0, robot.attackCooldown - 1);
    }
  }

  #simulateUndead() {
    const dt = 1 / this.rules.tickRate;
    const speedByKind = { drifter: 0.8, runner: 2.2, buried: 1.1 };
    for (const undead of this.state.undead.values()) {
      if (undead.status === 'dead') continue;
      const target = this.#nearestPlayer(undead.position);
      if (!target) continue;
      const distance = horizontalDistance(undead.position, target.position);
      if (undead.kind === 'buried' && undead.status === 'buried' && distance <= 4) {
        undead.status = 'active';
        this.#event('undead.emerged', { undeadId: undead.id });
      }
      if (undead.status !== 'active') continue;
      undead.targetId = target.id;
      if (distance > 1.2) {
        const direction = unitDirection(undead.position, target.position);
        const speed = speedByKind[undead.kind];
        undead.position.x = quantize(undead.position.x + direction.x * speed * dt);
        undead.position.z = quantize(undead.position.z + direction.z * speed * dt);
      } else if (undead.attackCooldown === 0) {
        this.#damage(target, undead.kind === 'runner' ? 7 : 4, undead.id);
        undead.attackCooldown = undead.kind === 'runner' ? 8 : 12;
      }
      undead.attackCooldown = Math.max(0, undead.attackCooldown - 1);
    }
  }

  #simulateMechs() {
    for (const mech of this.state.mechs.values()) {
      if (mech.status === 'disabled') {
        mech.action = null;
        continue;
      }
      mech.heat = quantize(Math.max(0, mech.heat - 2));
      mech.energy = quantize(Math.min(mech.energyMax, mech.energy + 0.2));
      if (mech.heat > mech.heatCapacity) {
        mech.status = 'overheated';
        mech.energy = Math.max(0, mech.energy - 1);
      } else if (mech.status === 'overheated' && mech.heat < mech.heatCapacity * 0.5) {
        mech.status = mech.pilotId ? 'piloted' : 'parked';
      } else if (mech.pilotId) {
        mech.status = 'piloted';
      } else if (mech.status === 'piloted') {
        mech.status = 'parked';
      }
      mech.action = null;
    }
  }

  #simulateBosses() {
    for (const boss of this.state.bosses.values()) {
      if (boss.status !== 'active') continue;
      boss.phase = boss.health <= boss.maxHealth * 0.5 ? 2 : 1;
      const target = this.#nearestPlayer(boss.position);
      if (!target) continue;
      boss.targetId = target.id;
      if (boss.attackCooldown === 0 && horizontalDistance(boss.position, target.position) <= 8) {
        this.#damage(target, boss.bossKey === 'foundry-giant' ? 12 : 8, boss.id);
        boss.attackCooldown = boss.phase === 2 ? 8 : 12;
      }
      boss.attackCooldown = Math.max(0, boss.attackCooldown - 1);
    }
  }

  #nearestPlayer(position) {
    let nearest = null;
    let nearestDistance = Infinity;
    for (const player of this.state.players.values()) {
      if (player.status !== 'active') continue;
      const distance = horizontalDistance(position, player.position);
      if (distance < nearestDistance || (distance === nearestDistance && player.id < nearest.id)) {
        nearest = player;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  #recalculateMech(mech) {
    let energyMax = 50;
    let heatCapacity = 100;
    let armor = 0;
    for (const entry of Object.values(mech.modules)) {
      const module = MODULES[entry.moduleKey];
      energyMax += module?.energyMax ?? 0;
      heatCapacity += module?.heatCapacity ? module.heatCapacity - 100 : 0;
      armor += module?.armor ?? 0;
    }
    mech.energyMax = energyMax;
    mech.energy = Math.min(mech.energy, mech.energyMax);
    mech.heatCapacity = heatCapacity;
    mech.armor = armor;
  }

  #mechMovementSpeed(mech) {
    const locomotion = mech.modules.locomotion;
    return MODULES[locomotion?.moduleKey]?.speed ?? 3;
  }

  #releaseMechPilot(mech, { placePlayer = true } = {}) {
    if (!mech) return;
    const pilotId = mech.pilotId;
    mech.pilotId = null;
    mech.input = { x: 0, z: 0 };
    if (mech.status !== 'disabled' && mech.status !== 'overheated') mech.status = 'parked';
    if (!pilotId) return;
    const player = this.state.players.get(pilotId);
    if (!player || player.mechId !== mech.id) return;
    player.mechId = null;
    player.input = { x: 0, z: 0, sprint: false };
    player.velocity = { x: 0, y: 0, z: 0 };
    if (placePlayer) player.position = this.#clampPosition({ ...mech.position, x: mech.position.x + 1.5 });
  }

  #removePassenger(vehicleId, playerId) {
    const vehicle = this.state.vehicles.get(vehicleId);
    if (!vehicle) return;
    if (vehicle.driverId === playerId) {
      vehicle.driverId = vehicle.passengerIds.shift() ?? null;
    } else {
      vehicle.passengerIds = vehicle.passengerIds.filter((id) => id !== playerId);
    }
  }

  #pruneCommandDedupe() {
    for (const [commandId, entry] of this.state.commandDedupe) {
      if (entry.expiresAtTick >= this.state.tick) break;
      this.state.commandDedupe.delete(commandId);
    }
    while (this.state.commandDedupe.size > this.rules.commandDedupeMaxEntries) {
      const oldest = this.state.commandDedupe.keys().next().value;
      if (oldest === undefined) break;
      this.state.commandDedupe.delete(oldest);
    }
  }

  #snapPosition(value = {}) {
    const position = positionOf(value);
    const size = this.rules.gridSize;
    return this.#clampPosition({ x: Math.round(position.x / size) * size, y: Math.round(position.y / size) * size, z: Math.round(position.z / size) * size });
  }

  #insideBounds(position) {
    return position.x >= this.rules.bounds.minX && position.x <= this.rules.bounds.maxX && position.z >= this.rules.bounds.minZ && position.z <= this.rules.bounds.maxZ;
  }

  #clampPosition(position) {
    return { x: quantize(clamp(finite(position.x), this.rules.bounds.minX, this.rules.bounds.maxX)), y: quantize(finite(position.y)), z: quantize(clamp(finite(position.z), this.rules.bounds.minZ, this.rules.bounds.maxZ)) };
  }
}

export function createWorld(options = {}) {
  return new WorldState(options);
}

export { DEFAULT_RULES, MODULES };

export default createWorld;
