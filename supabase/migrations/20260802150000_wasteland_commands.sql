-- Durable command inbox for the dedicated Wasteland Commons authority.
-- Apply after 20260802130000_wasteland_commons.sql.

create table if not exists public.wasteland_commands (
  id bigint generated always as identity primary key,
  world_id text not null references public.wasteland_rooms(world_id) on delete cascade,
  command_id text not null,
  command jsonb not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz null,
  unique (world_id, command_id)
);

create index if not exists wasteland_commands_pending_idx
  on public.wasteland_commands (world_id, created_at)
  where processed_at is null;

alter table public.wasteland_commands enable row level security;

-- The server relay is the only reader/writer. No public table policy is intentional.
revoke all on table public.wasteland_commands from public, anon, authenticated;
