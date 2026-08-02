-- Durable anonymous player resume capabilities for the dedicated relay.
-- Store only a hash of the bearer token; the raw token remains in the client
-- session and in the server connection URL, never in the database.

create table if not exists public.wasteland_player_sessions (
  world_id text not null references public.wasteland_rooms(world_id) on delete cascade,
  player_id text not null,
  token_hash text not null,
  connection_id text not null default '',
  display_name text not null default '',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (world_id, player_id)
);

create unique index if not exists wasteland_player_sessions_token_idx
  on public.wasteland_player_sessions (world_id, token_hash);

create index if not exists wasteland_player_sessions_expiry_idx
  on public.wasteland_player_sessions (world_id, expires_at);

alter table public.wasteland_player_sessions enable row level security;

-- The authoritative relay is the only reader/writer. The public client never
-- receives a Data API policy for this table.
revoke all on table public.wasteland_player_sessions from public, anon, authenticated;
