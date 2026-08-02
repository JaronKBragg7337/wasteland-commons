-- Dedicated Wasteland Commons authority lease.
-- Apply only after 20260802130000_wasteland_commons.sql in the new project.

create table if not exists public.wasteland_room_leases (
  world_id text primary key references public.wasteland_rooms(world_id) on delete cascade,
  owner_id text not null,
  lease_until timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.wasteland_room_leases enable row level security;

-- The relay calls these functions with a server-only Supabase key. They run as
-- the invoker, and there are deliberately no anon/authenticated table policies
-- or function permissions.
create or replace function public.try_claim_wasteland_lease(
  p_world_id text,
  p_owner_id text,
  p_lease_seconds integer default 9
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if nullif(trim(p_world_id), '') is null or nullif(trim(p_owner_id), '') is null then
    raise exception 'world and owner are required';
  end if;

  insert into public.wasteland_room_leases (world_id, owner_id, lease_until, updated_at)
  values (
    p_world_id,
    p_owner_id,
    clock_timestamp() + (greatest(3, least(30, coalesce(p_lease_seconds, 9))) * interval '1 second'),
    clock_timestamp()
  )
  on conflict (world_id) do update
  set owner_id = excluded.owner_id,
      lease_until = excluded.lease_until,
      updated_at = excluded.updated_at
  where wasteland_room_leases.lease_until < clock_timestamp()
     or wasteland_room_leases.owner_id = p_owner_id;

  return found;
end;
$$;

create or replace function public.release_wasteland_lease(
  p_world_id text,
  p_owner_id text
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  delete from public.wasteland_room_leases
  where world_id = p_world_id and owner_id = p_owner_id;
  return found;
end;
$$;

revoke all on table public.wasteland_room_leases from public, anon, authenticated;
revoke all on function public.try_claim_wasteland_lease(text, text, integer) from public, anon, authenticated;
revoke all on function public.release_wasteland_lease(text, text) from public, anon, authenticated;
grant execute on function public.try_claim_wasteland_lease(text, text, integer) to service_role;
grant execute on function public.release_wasteland_lease(text, text) to service_role;
