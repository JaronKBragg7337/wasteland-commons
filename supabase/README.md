# Wasteland Commons Supabase boundary

This directory contains the database contract for a dedicated Supabase project. It is not connected to, and must not be applied to, any existing workspace project.

The relay is the authority. It may persist snapshots and event records with a server-only `SUPABASE_SERVICE_ROLE_KEY`. When the lease migration is applied, Vercel WebSocket instances coordinate through a private Realtime room and one database-backed authority lease. That key must never appear in Vite assets, Capacitor assets, browser storage, logs, or public GitHub history.

Provisioning is intentionally deferred until the owner confirms the organization and the creation cost. Once a dedicated project exists, apply all three migrations in order, inspect the RLS/security advisors, exercise the lease/RPC, durable command inbox, and private Realtime room, and add the project URL/key only through deployment secrets.
