-- Wasteland Commons persistence contract.
-- Apply only to the dedicated Wasteland Commons Supabase project.
-- The public client never receives the service role key.

create table if not exists public.wasteland_rooms (
  world_id text primary key,
  world_seed text not null,
  protocol_version text not null default 'wasteland-authoritative/1',
  state jsonb not null,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.wasteland_events (
  id bigint generated always as identity primary key,
  world_id text not null references public.wasteland_rooms(world_id) on delete cascade,
  event_id text not null,
  tick bigint not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Keep an already-created dedicated project forward-compatible if this
-- migration is re-applied after an earlier development schema.
alter table public.wasteland_events add column if not exists event_id text;
update public.wasteland_events
set event_id = coalesce(nullif(event_id, ''), concat(tick, ':legacy-', id::text))
where event_id is null or event_id = '';
alter table public.wasteland_events alter column event_id set not null;
create unique index if not exists wasteland_events_world_event_idx
  on public.wasteland_events (world_id, event_id);

create index if not exists wasteland_events_world_tick_idx
  on public.wasteland_events (world_id, tick desc);

alter table public.wasteland_rooms enable row level security;
alter table public.wasteland_events enable row level security;

-- No public read/write policy is intentional: the authoritative relay owns persistence.
-- Add narrowly-scoped authenticated policies only when a player-facing read path exists.
