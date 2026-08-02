import WebSocket from 'ws';

const baseUrl = String(process.env.PUBLIC_GAME_URL ?? 'https://wasteland-commons.vercel.app').replace(/\/$/, '');
const healthUrl = `${baseUrl}/api/health`;
const manifestUrl = `${baseUrl}/api/manifest`;
const expectedRelayUrl = String(process.env.PUBLIC_RELAY_URL ?? `${baseUrl.replace(/^http/i, 'ws')}/api/ws`);
const waitMs = Number(process.env.PUBLIC_VERIFY_WAIT_MS ?? 1_500);
const sockets = [];

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function connectClient(index) {
  const socket = new WebSocket(expectedRelayUrl);
  sockets.push(socket);
  const snapshots = [];
  const welcome = await new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`client ${index + 1} did not receive a welcome within 12 seconds`));
    }, 12_000);
    socket.on('message', (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.type === 'snapshot' && message.snapshot) snapshots.push(message.snapshot);
      if (message.type !== 'welcome' || settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(message);
    });
    socket.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
  });
  return { socket, welcome, snapshots };
}

let sessions = [];
try {
  const healthResponse = await fetch(healthUrl);
  if (!healthResponse.ok) throw new Error(`health endpoint returned HTTP ${healthResponse.status}`);
  const health = await healthResponse.json();
  const manifestResponse = await fetch(manifestUrl);
  if (!manifestResponse.ok) throw new Error(`manifest endpoint returned HTTP ${manifestResponse.status}`);
  const publicManifest = await manifestResponse.json();
  sessions = await Promise.all([connectClient(0), connectClient(1)]);
  await delay(waitMs);

  const playerIds = sessions.map(({ welcome }) => welcome.playerId);
  const sharedSnapshot = sessions
    .flatMap(({ snapshots }) => snapshots)
    .find((snapshot) => playerIds.every((id) => snapshot.players.some((player) => player.id === id)));
  const result = {
    health,
    publicManifest: {
      release: publicManifest.release,
      license: publicManifest.license,
      scene: publicManifest.scene,
    },
    relay: expectedRelayUrl,
    clients: sessions.map(({ welcome, snapshots }) => ({
      playerId: welcome.playerId,
      welcomePlayers: welcome.players?.map((player) => player.id) ?? [],
      latestPlayers: snapshots.at(-1)?.players?.map((player) => player.id) ?? [],
    })),
    sharedSnapshot: Boolean(sharedSnapshot),
  };
  console.log(JSON.stringify(result, null, 2));
  if (!sharedSnapshot) {
    throw new Error('public multiplayer gate failed: no authoritative snapshot contained both clients');
  }
  console.log('Public multiplayer gate passed.');
} finally {
  for (const socket of sockets) socket.close();
}
