# Wasteland Commons Supabase boundary

This directory contains the database contract for a dedicated Supabase project. It is not connected to, and must not be applied to, any existing workspace project.

The relay is the authority. It may persist snapshots and event records with a server-only `SUPABASE_SECRET_KEY` (the legacy `SUPABASE_SERVICE_ROLE_KEY` remains supported as a fallback). When the lease migration is applied, Vercel WebSocket instances coordinate through a private Realtime room and one database-backed authority lease. That key must never appear in Vite assets, Capacitor assets, browser storage, logs, or public GitHub history.

The dedicated project is `wnwxihhjtoilmcilyyuk` in `ca-central-1`. Its four migrations are applied: the world/event contract, lease RPCs, durable command inbox, and the explicit public-access lockdown. The tables remain RLS-enabled and have no client-facing table grants; only the server relay may use them. Security and performance advisors are checked after each schema change, and lease semantics are exercised with an isolated probe before deployment.

The public Vercel project has the server URL configured. The final release gate is adding the server-only secret key through Vercel deployment secrets, then verifying two independent clients share the same room and that a newly elected relay restores the newer persisted snapshot. Do not commit a local `.env` file or copy the secret into GitHub.
