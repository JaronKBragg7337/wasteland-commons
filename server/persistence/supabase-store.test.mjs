import assert from 'node:assert/strict';
import test from 'node:test';
import { createSupabaseStore } from './supabase-store.mjs';

const originalFetch = globalThis.fetch;

function restoreEnvironment(previous) {
  if (previous.url === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = previous.url;
  if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
  globalThis.fetch = originalFetch;
}

test('unconfigured Supabase store is an explicit no-op', async () => {
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const store = createSupabaseStore({ worldId: 'test-world' });
    assert.equal(store.enabled, false);
    assert.deepEqual(await store.load(), null);
    assert.deepEqual(await store.persist({ revision: 1 }), { persisted: false, reason: 'not-configured' });
  } finally {
    restoreEnvironment(previous);
  }
});

test('configured store loads checkpoints and writes idempotent event records', async () => {
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SUPABASE_URL = 'https://example.supabase.co/';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-only-test-key';
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (options.method === 'POST') return { ok: true, status: 201 };
    return { ok: true, status: 200, async json() { return [{ state: { revision: 7, worldId: 'test-world' } }]; } };
  };
  try {
    const store = createSupabaseStore({ worldId: 'test-world' });
    assert.equal(store.enabled, true);
    assert.deepEqual(await store.load(), { revision: 7, worldId: 'test-world' });

    const snapshot = { worldId: 'test-world', worldSeed: 'seed', schemaVersion: 'protocol/1', revision: 8, events: [] };
    const result = await store.persist(snapshot, {
      events: [
        { eventId: '8:001', tick: 8, type: 'construction.completed' },
        { eventId: '8:001', tick: 8, type: 'construction.completed' },
        { eventId: '8:002', tick: 8, type: 'settlement.updated' },
      ],
    });

    assert.deepEqual(result, { persisted: true, revision: 8, events: 2 });
    assert.equal(requests.length, 4);
    const roomWrite = requests[1];
    assert.match(roomWrite.url, /wasteland_rooms\?on_conflict=world_id$/);
    assert.equal(roomWrite.options.headers.Prefer, 'resolution=merge-duplicates,return=minimal');
    const eventWrites = requests.slice(2);
    assert.equal(eventWrites[0].options.headers.Prefer, 'resolution=ignore-duplicates,return=minimal');
    assert.match(eventWrites[0].url, /on_conflict=world_id,event_id$/);
    assert.equal(JSON.parse(eventWrites[0].options.body).event_id, '8:001');
    assert.equal(JSON.parse(eventWrites[1].options.body).event_id, '8:002');
  } finally {
    restoreEnvironment(previous);
  }
});

test('configured store surfaces load failures instead of seeding a replacement world', async () => {
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-only-test-key';
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  try {
    await assert.rejects(() => createSupabaseStore({ worldId: 'test-world' }).load(), /Supabase wasteland_rooms read failed \(503\)/);
  } finally {
    restoreEnvironment(previous);
  }
});
