const SNAPSHOT_TABLE = 'wasteland_rooms';
const EVENT_TABLE = 'wasteland_events';

function configured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function endpoint(table) {
  return `${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${table}`;
}

function headers(prefer = 'resolution=merge-duplicates,return=minimal') {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
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

async function get(table, search = '') {
  const response = await fetch(`${endpoint(table)}${search}`, { headers: headers() });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Supabase ${table} read failed (${response.status})`);
  return response.json();
}

export function createSupabaseStore({ worldId } = {}) {
  const id = worldId ?? 'wasteland-commons';
  return {
    enabled: configured(),
    async load() {
      if (!configured()) return null;
      const rows = await get(SNAPSHOT_TABLE, `?world_id=eq.${encodeURIComponent(id)}&select=state&limit=1`);
      return rows?.[0]?.state ?? null;
    },
    async persist(snapshot, { events = snapshot.events ?? [] } = {}) {
      if (!configured()) return { persisted: false, reason: 'not-configured' };
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
  };
}

export default createSupabaseStore;
