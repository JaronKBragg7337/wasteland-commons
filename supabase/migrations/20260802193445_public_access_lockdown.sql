-- Lock the persistence contract to the server relay. RLS remains enabled as a
-- second boundary, but the Data API must not expose these tables to clients.
revoke all on table public.wasteland_rooms from public, anon, authenticated;
revoke all on table public.wasteland_events from public, anon, authenticated;
revoke all on table public.wasteland_room_leases from public, anon, authenticated;
revoke all on table public.wasteland_commands from public, anon, authenticated;
