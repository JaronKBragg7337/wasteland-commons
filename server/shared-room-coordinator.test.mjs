import assert from 'node:assert/strict';
import test from 'node:test';
import { createSharedRoomCoordinator } from './shared-room-coordinator.mjs';

test('shared room coordinator is an explicit no-op without a dedicated server backend', async () => {
  const previous = {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const coordinator = createSharedRoomCoordinator({
      worldId: 'saltglass-basin',
      persistence: { enabled: false },
    });
    assert.equal(coordinator.enabled, false);
    assert.equal(coordinator.topic, 'wasteland:saltglass-basin:authority-v1');
    assert.deepEqual(await coordinator.start(), {
      enabled: false,
      ready: false,
      leader: false,
      topic: 'wasteland:saltglass-basin:authority-v1',
    });
    assert.deepEqual(await coordinator.publishCommand({ type: 'player.join' }), {
      published: false,
      reason: 'not-configured',
    });
  } finally {
    if (previous.url === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
  }
});

test('shared room coordinator elects an authority and routes Realtime envelopes', async () => {
  const previous = {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  process.env.SUPABASE_URL = 'https://dedicated.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-only-test-key';
  const callbacks = new Map();
  const sent = [];
  const channel = {
    on(_type, filter, callback) {
      callbacks.set(filter.event, callback);
      return this;
    },
    subscribe(callback) {
      queueMicrotask(() => callback('SUBSCRIBED'));
      return this;
    },
    async send(message) {
      sent.push(message);
      return 'ok';
    },
  };
  const client = {
    channel() { return channel; },
    async removeChannel() {},
  };
  const receivedCommands = [];
  const receivedSnapshots = [];
  let released = false;
  try {
    const coordinator = createSharedRoomCoordinator({
      worldId: 'saltglass-basin',
      instanceId: 'relay-a',
      persistence: {
        enabled: true,
        async claimLease() { return true; },
        async releaseLease() { released = true; },
      },
      realtimeClientFactory: async () => client,
      onCommand(command) { receivedCommands.push(command); },
      onSnapshot(snapshot) { receivedSnapshots.push(snapshot); },
    });
    const started = await coordinator.start();
    assert.equal(started.leader, true);
    assert.equal(coordinator.ready, true);
    await coordinator.publishCommand({ type: 'player.move', commandId: 'move-1' });
    await coordinator.publishSnapshot({ worldId: 'saltglass-basin', revision: 4 });
    callbacks.get('command')({ payload: { originInstanceId: 'relay-b', command: { type: 'player.join' } } });
    callbacks.get('snapshot')({ payload: { originInstanceId: 'relay-b', snapshot: { revision: 5 } } });
    assert.equal(receivedCommands.length, 1);
    assert.deepEqual(receivedCommands[0], { type: 'player.join' });
    assert.deepEqual(receivedSnapshots[0], { revision: 5 });
    assert.equal(sent.some((message) => message.event === 'command'), true);
    assert.equal(sent.some((message) => message.event === 'snapshot'), true);
    await coordinator.stop();
    assert.equal(released, true);
  } finally {
    if (previous.url === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
  }
});
