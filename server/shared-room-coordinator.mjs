import { randomUUID } from 'node:crypto';
import { supabaseConfigured, supabaseServerKey, supabaseUrl } from './persistence/supabase-config.mjs';

const DEFAULT_LEASE_SECONDS = 9;
const LEASE_RENEW_INTERVAL_MS = 3_000;
const SUBSCRIBE_TIMEOUT_MS = 12_000;
const MAX_PENDING_MESSAGES = 2_000;

function configured() {
  return supabaseConfigured();
}

function topicFor(worldId) {
  const safeWorldId = String(worldId ?? 'wasteland-commons')
    .replace(/[^a-zA-Z0-9:_-]/g, '-')
    .slice(0, 80);
  return `wasteland:${safeWorldId}:authority-v1`;
}

function responseStatusIsOk(response) {
  return response === 'ok' || response?.status === 'ok';
}

function payloadOf(message) {
  return message?.payload && typeof message.payload === 'object' ? message.payload : message;
}

/**
 * Coordinates Vercel WebSocket instances around one leased authoritative
 * simulation. With no dedicated Supabase project configured it is an explicit
 * no-op, leaving the local relay mode available for development and tests.
 */
export function createSharedRoomCoordinator({
  worldId = 'wasteland-commons',
  persistence,
  instanceId = `relay-${randomUUID()}`,
  leaseSeconds = DEFAULT_LEASE_SECONDS,
  realtimeClientFactory,
  onCommand,
  onSnapshot,
  onSnapshotRequest,
  onLeadershipChange,
} = {}) {
  const enabled = Boolean(configured() && persistence?.enabled);
  const topic = topicFor(worldId);
  let client = null;
  let channel = null;
  let ready = false;
  let leader = false;
  let leaseTimer = null;
  let pendingMessages = [];
  let stopping = false;

  async function defaultRealtimeClientFactory() {
    const { createClient } = await import('@supabase/supabase-js');
    const key = supabaseServerKey();
    return createClient(supabaseUrl(), key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 40 } },
      global: { headers: { 'x-client-info': 'wasteland-commons-relay/1' } },
    });
  }

  async function sendNow(event, payload) {
    if (!channel || !ready) throw new Error('shared room channel is not ready');
    const response = await channel.send({
      type: 'broadcast',
      event,
      payload: {
        ...payload,
        originInstanceId: instanceId,
        sentAt: Date.now(),
      },
    });
    if (!responseStatusIsOk(response)) throw new Error(`shared room broadcast failed for ${event}`);
    return response;
  }

  async function flushPending() {
    while (ready && pendingMessages.length && !stopping) {
      const message = pendingMessages[0];
      try {
        await sendNow(message.event, message.payload);
        pendingMessages.shift();
      } catch (error) {
        console.error(`Shared room message held for retry: ${error.message}`);
        return;
      }
    }
  }

  function publish(event, payload = {}) {
    if (!enabled) return Promise.resolve({ published: false, reason: 'not-configured' });
    if (!ready) {
      if (pendingMessages.length >= MAX_PENDING_MESSAGES) {
        pendingMessages.shift();
      }
      pendingMessages.push({ event, payload });
      return Promise.resolve({ published: false, queued: true });
    }
    return sendNow(event, payload).catch((error) => {
      if (pendingMessages.length < MAX_PENDING_MESSAGES) pendingMessages.push({ event, payload });
      throw error;
    });
  }

  async function setLeadership(nextLeader) {
    const changed = leader !== nextLeader;
    leader = nextLeader;
    if (changed) await onLeadershipChange?.(leader);
  }

  async function renewLease({ throwOnError = false } = {}) {
    if (!enabled || stopping) return false;
    try {
      const claimed = await persistence.claimLease(instanceId, leaseSeconds);
      await setLeadership(Boolean(claimed));
      if (claimed) await flushPending();
      return Boolean(claimed);
    } catch (error) {
      if (leader) console.error(`Shared room lease lost: ${error.message}`);
      await setLeadership(false);
      if (throwOnError) throw error;
      return false;
    }
  }

  async function subscribe() {
    client = realtimeClientFactory
      ? await realtimeClientFactory()
      : await defaultRealtimeClientFactory();
    channel = client.channel(topic, {
      config: {
        private: true,
        broadcast: { self: false, ack: true },
      },
    });
    channel.on('broadcast', { event: 'command' }, (message) => {
      const payload = payloadOf(message);
      if (payload.originInstanceId === instanceId || !leader) return;
      onCommand?.(payload.command, payload);
    });
    channel.on('broadcast', { event: 'snapshot' }, (message) => {
      const payload = payloadOf(message);
      if (payload.originInstanceId === instanceId || !payload.snapshot) return;
      onSnapshot?.(payload.snapshot, payload);
    });
    channel.on('broadcast', { event: 'snapshot-request' }, (message) => {
      const payload = payloadOf(message);
      if (payload.originInstanceId === instanceId || !leader) return;
      onSnapshotRequest?.(payload);
    });
    await new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`shared room subscription timed out for ${topic}`));
      }, SUBSCRIBE_TIMEOUT_MS);
      channel.subscribe((status, error) => {
        if (settled) return;
        if (status === 'SUBSCRIBED') {
          settled = true;
          clearTimeout(timeout);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          settled = true;
          clearTimeout(timeout);
          reject(error instanceof Error ? error : new Error(`shared room subscription status: ${status}`));
        }
      });
    });
    ready = true;
  }

  async function start() {
    if (!enabled) return { enabled: false, ready: false, leader: false, topic };
    try {
      await subscribe();
      await renewLease({ throwOnError: true });
      leaseTimer = setInterval(() => { renewLease().catch(() => {}); }, LEASE_RENEW_INTERVAL_MS);
      leaseTimer.unref?.();
      await publish('snapshot-request', { requestedBy: instanceId });
      return { enabled: true, ready, leader, topic, instanceId };
    } catch (error) {
      await stop();
      throw error;
    }
  }

  async function stop() {
    stopping = true;
    if (leaseTimer) clearInterval(leaseTimer);
    leaseTimer = null;
    if (leader) {
      try { await persistence.releaseLease(instanceId); } catch (error) { console.error(`Shared room lease release failed: ${error.message}`); }
    }
    leader = false;
    ready = false;
    pendingMessages = [];
    if (client && channel) {
      try { await client.removeChannel(channel); } catch { /* best effort during shutdown */ }
    }
    channel = null;
    client = null;
  }

  return {
    enabled,
    topic,
    instanceId,
    get ready() { return ready; },
    get isLeader() { return leader; },
    start,
    stop,
    publish,
    publishCommand(command) { return publish('command', { command }); },
    publishSnapshot(snapshot) { return publish('snapshot', { snapshot }); },
    requestSnapshot() { return publish('snapshot-request', { requestedBy: instanceId }); },
  };
}

export default createSharedRoomCoordinator;
