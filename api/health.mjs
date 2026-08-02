const release = 'saltglass-basin-2026-08-02';
const sharedBackendConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

export default function healthHandler(_request, response) {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.statusCode = 200;
  response.end(JSON.stringify({
    service: 'wasteland-commons',
    status: 'ready',
    release,
    websocketPath: '/api/ws',
    multiplayer: sharedBackendConfigured ? 'shared-realtime-configured' : 'instance-local-until-shared-relay-is-configured',
    persistence: sharedBackendConfigured ? 'dedicated-supabase-configured' : 'local-memory-until-dedicated-supabase-is-configured',
    publicReleaseGate: sharedBackendConfigured ? 'runtime-verification-required' : 'shared-multiplayer-pending',
  }));
}
