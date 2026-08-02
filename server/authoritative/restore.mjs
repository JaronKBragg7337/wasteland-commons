import { createWorld } from './world-state.mjs';

const COLLECTIONS = ['players', 'npcs', 'robots', 'undead', 'vehicles', 'constructions', 'mechs', 'bosses'];
const ID_KINDS = ['player', 'npc', 'robot', 'undead', 'vehicle', 'construction', 'mech', 'module', 'boss'];
const KIND_COLLECTIONS = {
  player: 'players', npc: 'npcs', robot: 'robots', undead: 'undead', vehicle: 'vehicles',
  construction: 'constructions', mech: 'mechs', boss: 'bosses',
};

function clone(value) {
  return structuredClone(value);
}

function numericSuffix(id) {
  const match = String(id).match(/-(\d+)$/);
  return match ? Number(match[1]) : 0;
}

/**
 * Rehydrates an authoritative world from a persisted snapshot.
 * Queued commands and dedupe entries are intentionally not restored: clients
 * must resync and retry only commands that carry a new idempotency key.
 */
export function restoreWorld(snapshot, options = {}) {
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError('snapshot must be an object');
  const world = createWorld({
    worldId: snapshot.worldId,
    worldSeed: snapshot.worldSeed,
    rules: options.rules,
  });
  const state = world.state;
  state.tick = Math.max(0, Number(snapshot.tick) || 0);
  state.revision = Math.max(0, Number(snapshot.revision) || 0);
  state.lastProcessedCommandSequence = Math.max(0, Number(snapshot.lastProcessedCommandSequence) || 0);
  state.nextCommandSequence = state.lastProcessedCommandSequence + 1;
  state.events = clone(Array.isArray(snapshot.events) ? snapshot.events : []);
  state.settlement = clone(snapshot.settlement ?? state.settlement);

  for (const collection of COLLECTIONS) {
    const values = Array.isArray(snapshot[collection]) ? snapshot[collection] : [];
    state[collection] = new Map(values.filter((value) => value?.id).map((value) => [value.id, clone(value)]));
  }

  for (const kind of ID_KINDS) {
    const values = state[KIND_COLLECTIONS[kind]];
    const highest = values instanceof Map ? Math.max(0, ...[...values.keys()].map(numericSuffix)) : 0;
    state.nextIds[kind] = highest + 1;
  }
  state.queuedCommands = new Map();
  state.commandDedupe = new Map();
  state.activeCommand = null;
  return world;
}

export default restoreWorld;
