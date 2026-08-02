import { supabaseConfigured, supabaseServerKey, supabaseUrl } from './supabase-config.mjs';

const SNAPSHOT_TABLE = 'wasteland_rooms';
const EVENT_TABLE = 'wasteland_events';
const COMMAND_TABLE = 'wasteland_commands';
const CLAIM_LEASE_RPC = 'try_claim_wasteland_lease';
const RELEASE_LEASE_RPC = 'release_wasteland_lease';

function endpoint(table) {
  return `${supabaseUrl()}/rest/v1/${table}`;
}

function headers(prefer = 'resolution=merge-duplicates,return=minimal') {
  const key = supabaseServerKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'content-type': 'application/json',
    Prefer: prefer,
  };
}

async function post(table, body, search = '', prefer) {
  const response = await fetch(`${endpoint(table)}${search}`, { method: 'POST', headers: headers(prefer), body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Supabase ${table} write failed (${response.status})`);
}

async function get(table, search = '', { notFoundIsNull = true } = {}) {
  const response = await fetch(`${endpoint(table)}${search}`, { headers: headers() });
  if (response.status === 404 && notFoundIsNull) return null;
  if (!response.ok) throw new Error(`Supabase ${table} read failed (${response.status})`);
  return response.json();
}

async function rpc(functionName, body) {
  const response = await fetch(`${supabaseUrl()}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: headers('return=representation'),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Supabase RPC ${functionName} failed (${response.status})`);
  return response.json();
}

function booleanResult(value) {
  if (value === true || value === 'true') return true;
  if (Array.isArray(value)) return booleanResult(value[0]);
  if (value && typeof value === 'object') {
    const named = value.claimed ?? value.released ?? value.result;
    if (named !== undefined) return booleanResult(named);
    const values = Object.values(value);
    if (values.length === 1) return booleanResult(values[0]);
  }
  return false;
}

export function createSupabaseStore({ worldId } = {}) {
  const id = worldId ?? 'wasteland-commons';
  return {
    enabled: supabaseConfigured(),
    async load() {
      if (!supabaseConfigured()) return null;
      const rows = await get(SNAPSHOT_TABLE, `?world_id=eq.${encodeURIComponent(id)}&select=state&limit=1`);
      return rows?.[0]?.state ?? null;
    },
    async persist(snapshot, { events = snapshot.events ?? [] } = {}) {
      if (!supabaseConfigured()) return { persisted: false, reason: 'not-configured' };
      await post(SNAPSHOT_TABLE, {
        world_id: id,
        world_seed: snapshot.worldSeed,
        protocol_version: snapshot.schemaVersion,
        state: snapshot,
        revision: snapshot.revision,
      }, '?on_conflict=world_id');

      const uniqueEvents = new Map();
      for (const [index, event] of events.entries()) {
        const eventId = String(event?.eventId ?? `${event?.tick ?? snapshot.tick}:event-${index + 1}`).trim();
        if (!eventId) continue;
        uniqueEvents.set(eventId, { event, eventId });
      }
      for (const { event, eventId } of uniqueEvents.values()) {
        await post(EVENT_TABLE, {
          world_id: id,
          event_id: eventId,
          tick: event.tick ?? snapshot.tick,
          event_type: event.type ?? 'unknown',
          payload: event,
        }, '?on_conflict=world_id,event_id', 'resolution=ignore-duplicates,return=minimal');
      }
      return { persisted: true, revision: snapshot.revision, events: uniqueEvents.size };
    },
    async claimLease(ownerId, leaseSeconds = 9) {
      if (!supabaseConfigured()) return false;
      const result = await rpc(CLAIM_LEASE_RPC, {
        p_world_id: id,
        p_owner_id: String(ownerId),
        p_lease_seconds: Math.max(3, Math.min(30, Number(leaseSeconds) || 9)),
      });
      return booleanResult(result);
    },
    async releaseLease(ownerId) {
      if (!supabaseConfigured()) return false;
      const result = await rpc(RELEASE_LEASE_RPC, {
        p_world_id: id,
        p_owner_id: String(ownerId),
      });
      return booleanResult(result);
    },
    async enqueueCommand(command) {
      if (!supabaseConfigured()) return { persisted: false, reason: 'not-configured' };
      const commandId = String(command?.commandId ?? '').trim();
      if (!commandId) throw new Error('durable command requires commandId');
      await post(COMMAND_TABLE, {
        world_id: id,
        command_id: commandId,
        command,
      }, '?on_conflict=world_id,command_id', 'resolution=ignore-duplicates,return=minimal');
      return { persisted: true, commandId };
    },
    async pendingCommands(limit = 500) {
      if (!supabaseConfigured()) return [];
      const boundedLimit = Math.max(1, Math.min(2_000, Number(limit) || 500));
      const rows = await get(COMMAND_TABLE, `?world_id=eq.${encodeURIComponent(id)}&processed_at=is.null&select=command_id,command&order=created_at.asc&limit=${boundedLimit}`, { notFoundIsNull: false });
      return (rows ?? []).map((row) => row.command).filter((command) => command && typeof command === 'object');
    },
    async markCommandProcessed(commandId) {
      if (!supabaseConfigured()) return { persisted: false, reason: 'not-configured' };
      const value = String(commandId ?? '').trim();
      if (!value) return { persisted: false, reason: 'missing-command-id' };
      const response = await fetch(`${endpoint(COMMAND_TABLE)}?world_id=eq.${encodeURIComponent(id)}&command_id=eq.${encodeURIComponent(value)}&processed_at=is.null`, {
        method: 'PATCH',
        headers: headers('return=minimal'),
        body: JSON.stringify({ processed_at: new Date().toISOString() }),
      });
      if (!response.ok) throw new Error(`Supabase ${COMMAND_TABLE} acknowledgement failed (${response.status})`);
      return { persisted: true, commandId: value };
    },
  };
}

export default createSupabaseStore;
