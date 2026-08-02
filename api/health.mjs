const release = 'saltglass-basin-2026-08-02';

export default function healthHandler(_request, response) {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.statusCode = 200;
  response.end(JSON.stringify({
    service: 'wasteland-commons',
    status: 'ready',
    release,
    websocketPath: '/api/ws',
    multiplayer: 'instance-local-until-shared-relay-is-configured',
    persistence: 'local-memory-until-dedicated-supabase-is-configured',
    publicReleaseGate: 'shared-multiplayer-pending',
  }));
}
