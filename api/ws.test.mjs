import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import WebSocket from 'ws';

const previousEnvironment = {
  url: process.env.SUPABASE_URL,
  secret: process.env.SUPABASE_SECRET_KEY,
  legacy: process.env.SUPABASE_SERVICE_ROLE_KEY,
};
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const { default: server } = await import(`./ws.mjs?test=${Date.now()}`);

function restoreEnvironment() {
  if (previousEnvironment.url === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = previousEnvironment.url;
  if (previousEnvironment.secret === undefined) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = previousEnvironment.secret;
  if (previousEnvironment.legacy === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = previousEnvironment.legacy;
}

function connect(url) {
  const socket = new WebSocket(url);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error('relay welcome timed out'));
    }, 5_000);
    socket.on('message', (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.type === 'welcome') {
        clearTimeout(timeout);
        resolve({ socket, welcome: message });
      } else if (message.type === 'error') {
        clearTimeout(timeout);
        reject(new Error(String(message.reason ?? 'relay rejected connection')));
      }
    });
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function close(socket) {
  if (socket.readyState === WebSocket.CLOSED) return;
  await new Promise((resolve) => {
    socket.once('close', resolve);
    socket.close();
  });
}

test('relay resumes the same anonymous player before the grace window expires', async () => {
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    const first = await connect(`ws://127.0.0.1:${port}/api/ws`);
    assert.equal(first.welcome.resumed, false);
    assert.match(first.welcome.playerId, /^SURVIVOR-/);
    assert.ok(first.welcome.resumeToken);

    // The relay applies the join on its fixed simulation step, not during the
    // handshake. Give that authoritative snapshot one tick before reconnecting.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await close(first.socket);
    const second = await connect(`ws://127.0.0.1:${port}/api/ws?playerId=${encodeURIComponent(first.welcome.playerId)}&resumeToken=${encodeURIComponent(first.welcome.resumeToken)}`);
    assert.equal(second.welcome.resumed, true);
    assert.equal(second.welcome.playerId, first.welcome.playerId);
    await close(second.socket);
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    restoreEnvironment();
  }
});
