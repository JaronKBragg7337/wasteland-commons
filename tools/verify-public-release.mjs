import WebSocket from 'ws';

const baseUrl = String(process.env.PUBLIC_GAME_URL ?? 'https://wasteland-commons.vercel.app').replace(/\/$/, '');
const healthUrl = `${baseUrl}/api/health`;
const manifestUrl = `${baseUrl}/api/manifest`;
const expectedRelayUrl = String(process.env.PUBLIC_RELAY_URL ?? `${baseUrl.replace(/^http/i, 'ws')}/api/ws`);
const waitMs = positiveMilliseconds(process.env.PUBLIC_VERIFY_WAIT_MS, 12_000);
const persistenceWaitMs = positiveMilliseconds(process.env.PUBLIC_VERIFY_PERSIST_WAIT_MS, 6_000);
const reconnectPauseMs = positiveMilliseconds(process.env.PUBLIC_VERIFY_RECONNECT_PAUSE_MS, 1_000);
const sockets = new Set();

// This is intentionally stable and unmistakable. Re-running the verifier is
// idempotent: an existing matching record is inspected, never overwritten.
const verification = Object.freeze({
  marker: 'WASTELAND_COMMONS_PUBLIC_RELEASE_VERIFICATION',
  constructionId: 'VERIFY-CONSTRUCTION-SALTGLASS-BASIN-0001',
  commandId: 'VERIFY-COMMAND-SALTGLASS-BASIN-0001',
  blueprint: 'foundation',
  requestedPosition: Object.freeze({ x: 0, y: 0, z: 28 }),
  expectedPosition: Object.freeze({ x: 0, y: 0.8, z: 28 }),
});

function positiveMilliseconds(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function positionMatches(actual, expected, tolerance = 0.001) {
  return Boolean(actual)
    && Math.abs(Number(actual.x) - expected.x) <= tolerance
    && Math.abs(Number(actual.y) - expected.y) <= tolerance
    && Math.abs(Number(actual.z) - expected.z) <= tolerance;
}

function constructionFor(snapshot) {
  return snapshot?.constructions?.find((construction) => construction.id === verification.constructionId) ?? null;
}

function matchesVerificationConstruction(construction) {
  return Boolean(construction)
    && construction.id === verification.constructionId
    && construction.blueprint === verification.blueprint
    && positionMatches(construction.position, verification.expectedPosition);
}

function placementEventFor(snapshot) {
  return snapshot?.events?.some((event) => (
    event.type === 'construction.placed'
    && event.constructionId === verification.constructionId
    && event.commandId === verification.commandId
  )) ?? false;
}

function sameConstructionCell(first, second) {
  return Boolean(first?.position && second?.position)
    && Number(first.position.x) === Number(second.position.x)
    && Number(first.position.z) === Number(second.position.z);
}

function sharedBackendReasons(health) {
  const reasons = [];
  if (health?.multiplayer !== 'shared-realtime-configured') {
    reasons.push(`multiplayer=${String(health?.multiplayer ?? 'missing')}`);
  }
  if (health?.persistence !== 'dedicated-supabase-configured') {
    reasons.push(`persistence=${String(health?.persistence ?? 'missing')}`);
  }
  if (health?.publicReleaseGate === 'shared-multiplayer-pending') {
    reasons.push('publicReleaseGate=shared-multiplayer-pending');
  }
  return reasons;
}

function sharedPlayerSnapshots(sessions) {
  const playerIds = sessions.map(({ welcome }) => welcome.playerId);
  const perClient = sessions.map((session) => session.snapshots.find((snapshot) => (
    playerIds.every((id) => snapshot.players?.some((player) => player.id === id))
  )) ?? null);
  return perClient.every(Boolean) ? perClient : null;
}

function latestMatchingConstruction(session) {
  for (let index = session.snapshots.length - 1; index >= 0; index -= 1) {
    const construction = constructionFor(session.snapshots[index]);
    if (construction) return construction;
  }
  return null;
}

function constructionSummary(construction) {
  if (!construction) return null;
  return {
    id: construction.id,
    blueprint: construction.blueprint,
    position: construction.position,
    status: construction.status,
    progress: construction.progress,
  };
}

async function waitUntil(label, predicate, sessions = [], timeout = waitMs) {
  const deadline = Date.now() + timeout;
  while (Date.now() <= deadline) {
    for (const session of sessions) {
      if (session.failure) throw new Error(`${label} aborted: ${session.failure}`);
    }
    const result = predicate();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`${label} was not observed within ${timeout}ms`);
}

async function connectClient(index) {
  const socket = new WebSocket(expectedRelayUrl);
  sockets.add(socket);
  const session = {
    index,
    socket,
    snapshots: [],
    messages: [],
    welcome: null,
    failure: null,
    closed: false,
  };

  const welcome = await new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`client ${index + 1} did not receive a welcome within 12 seconds`));
    }, 12_000);
    const settle = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(value);
    };
    socket.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      session.messages.push(message);
      if (message.type === 'snapshot' && message.snapshot) session.snapshots.push(message.snapshot);
      if (message.type === 'welcome') {
        if (message.snapshot) session.snapshots.push(message.snapshot);
        session.welcome = message;
        settle(null, message);
      } else if (message.type === 'error') {
        settle(new Error(`relay rejected client ${index + 1}: ${String(message.reason ?? 'unknown error')}`));
      }
    });
    socket.on('error', (error) => {
      session.failure = error instanceof Error ? error.message : String(error);
      settle(error);
    });
    socket.on('close', (code, reason) => {
      session.closed = true;
      if (!settled) settle(new Error(`client ${index + 1} closed before welcome (${code}: ${reason.toString()})`));
    });
  });

  session.welcome = welcome;
  session.send = (message) => {
    if (socket.readyState !== 1) throw new Error(`client ${index + 1} is not connected`);
    socket.send(JSON.stringify(message));
  };
  session.close = async (reason = 'public verifier reconnect boundary') => {
    if (socket.readyState === 3) {
      session.closed = true;
      return;
    }
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        session.closed = true;
        resolve();
      };
      const timeout = setTimeout(() => {
        socket.terminate();
        finish();
      }, 3_000);
      socket.once('close', finish);
      try {
        if (socket.readyState === 0) socket.terminate();
        else socket.close(1000, reason);
      } catch {
        socket.terminate();
        finish();
      }
    });
  };
  return session;
}

function printGatedFailure({ health, publicManifest }) {
  const reasons = sharedBackendReasons(health);
  console.log(JSON.stringify({
    health,
    publicManifest: {
      release: publicManifest.release,
      license: publicManifest.license,
      scene: publicManifest.scene,
    },
    relay: expectedRelayUrl,
    backend: {
      configured: false,
      reasons,
    },
    verification: {
      marker: verification.marker,
      constructionId: verification.constructionId,
      commandId: verification.commandId,
      action: 'not-attempted',
    },
    clients: [],
    sharedSnapshot: false,
    durableConstruction: false,
  }, null, 2));
  throw new Error(`shared backend unavailable; refusing verification mutation: ${reasons.join('; ') || 'health did not advertise a configured shared backend'}`);
}

async function main() {
  const healthResponse = await fetch(healthUrl);
  if (!healthResponse.ok) throw new Error(`health endpoint returned HTTP ${healthResponse.status}`);
  const health = await healthResponse.json();
  const manifestResponse = await fetch(manifestUrl);
  if (!manifestResponse.ok) throw new Error(`manifest endpoint returned HTTP ${manifestResponse.status}`);
  const publicManifest = await manifestResponse.json();

  const backendReasons = sharedBackendReasons(health);
  if (backendReasons.length) printGatedFailure({ health, publicManifest });

  const gridSize = Number(publicManifest.scene?.grid?.cellSizeMeters);
  const bounds = publicManifest.scene?.grid?.bounds;
  if (!Number.isFinite(gridSize) || gridSize <= 0) throw new Error('public manifest does not expose a valid grid cell size');
  if (!bounds || verification.expectedPosition.x < Number(bounds.min.x) || verification.expectedPosition.x > Number(bounds.max.x)
    || verification.expectedPosition.z < Number(bounds.min.z) || verification.expectedPosition.z > Number(bounds.max.z)) {
    throw new Error('reserved verification construction position is outside the public world bounds; refusing mutation');
  }
  if (Math.abs(verification.requestedPosition.x / gridSize - Math.round(verification.requestedPosition.x / gridSize)) > 0.0001
    || Math.abs(verification.requestedPosition.z / gridSize - Math.round(verification.requestedPosition.z / gridSize)) > 0.0001) {
    throw new Error('reserved verification construction position is not aligned to the public grid; refusing mutation');
  }

  let sessions = await Promise.all([connectClient(0), connectClient(1)]);
  let commandAction = 'placed-now';
  try {
    const initialSharedSnapshots = await waitUntil(
      'shared authoritative player snapshot',
      () => sharedPlayerSnapshots(sessions),
      sessions,
    );

    const observedConstructions = sessions
      .map(latestMatchingConstruction)
      .filter(Boolean);
    if (observedConstructions.length && observedConstructions.some((construction) => !matchesVerificationConstruction(construction))) {
      throw new Error(`verification ID ${verification.constructionId} already exists with an unexpected payload; refusing to overwrite it`);
    }

    if (!observedConstructions.length) {
      const occupiedCell = initialSharedSnapshots
        .flatMap((snapshot) => snapshot.constructions ?? [])
        .find((construction) => sameConstructionCell(construction, { position: verification.expectedPosition }));
      if (occupiedCell) {
        throw new Error(`reserved verification cell is occupied by ${occupiedCell.id}; refusing arbitrary mutation`);
      }

      sessions[0].send({
        type: 'command',
        command: 'build',
        commandId: verification.commandId,
        verification: {
          marker: verification.marker,
          purpose: 'durable construction reconnect verification',
        },
        record: {
          id: verification.constructionId,
          label: verification.marker,
          position: verification.requestedPosition,
        },
      });
    } else {
      commandAction = 'inspected-existing-verification-record';
    }

    const replicated = await waitUntil(
      'authoritative construction replication to both clients',
      () => {
        const perClient = sessions.map(latestMatchingConstruction);
        const allClientsHaveConstruction = perClient.every(matchesVerificationConstruction);
        const sawPlacementEvent = sessions.some((session) => session.snapshots.some(placementEventFor));
        return allClientsHaveConstruction && (commandAction !== 'placed-now' || sawPlacementEvent)
          ? perClient
          : null;
      },
      sessions,
    );

    const completed = await waitUntil(
      'authoritative construction completion on both clients',
      () => {
        const perClient = sessions.map(latestMatchingConstruction);
        return perClient.every((construction) => construction?.status === 'complete') ? perClient : null;
      },
      sessions,
    );

    // The relay checkpoints at a fixed cadence. Keep both clients attached
    // through a full checkpoint window before testing the reconnect boundary.
    await delay(persistenceWaitMs);
    const beforeReconnect = {
      replicated: replicated.map(constructionSummary),
      completed: completed.map(constructionSummary),
    };

    await Promise.all(sessions.map((session) => session.close()));
    await delay(reconnectPauseMs);
    sessions = await Promise.all([connectClient(0), connectClient(1)]);

    const reconnectWelcomeConstructions = sessions.map((session) => constructionFor(session.welcome.snapshot));
    const survivedReconnect = await waitUntil(
      'verification construction after reconnect',
      () => {
        const perClient = sessions.map(latestMatchingConstruction);
        return perClient.every(matchesVerificationConstruction) ? perClient : null;
      },
      sessions,
    );
    if (!reconnectWelcomeConstructions.every(matchesVerificationConstruction)) {
      throw new Error('reconnected clients did not receive the verification construction in their authoritative welcome snapshot');
    }
    if (!survivedReconnect.every((construction) => construction.status === 'complete')) {
      throw new Error('verification construction survived reconnect but was not complete on every client');
    }

    console.log(JSON.stringify({
      health,
      publicManifest: {
        release: publicManifest.release,
        license: publicManifest.license,
        scene: publicManifest.scene,
      },
      relay: expectedRelayUrl,
      backend: {
        configured: true,
        persistenceWaitMs,
      },
      verification: {
        marker: verification.marker,
        constructionId: verification.constructionId,
        commandId: verification.commandId,
        action: commandAction,
        requestedPosition: verification.requestedPosition,
        expectedPosition: verification.expectedPosition,
        beforeReconnect,
        reconnectWelcome: reconnectWelcomeConstructions.map(constructionSummary),
        afterReconnect: survivedReconnect.map(constructionSummary),
        survivedReconnect: true,
      },
      clients: sessions.map(({ welcome, snapshots }) => ({
        playerId: welcome.playerId,
        welcomePlayers: welcome.players?.map((player) => player.id) ?? [],
        latestPlayers: snapshots.at(-1)?.players?.map((player) => player.id) ?? [],
        sawVerificationConstruction: snapshots.some((snapshot) => matchesVerificationConstruction(constructionFor(snapshot))),
      })),
      sharedSnapshot: true,
      durableConstruction: true,
    }, null, 2));
    console.log('Public multiplayer + durable construction reconnect gate passed.');
  } finally {
    await Promise.allSettled(sessions.map((session) => session.close()));
  }
}

try {
  await main();
} catch (error) {
  console.error(`Public release verifier failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await Promise.allSettled([...sockets].map((socket) => {
    if (socket.readyState === 3) return Promise.resolve();
    socket.terminate();
    return Promise.resolve();
  }));
}
