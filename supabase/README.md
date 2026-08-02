# Wasteland Commons Supabase boundary

This directory contains the database contract for a dedicated Supabase project. It is not connected to, and must not be applied to, any existing workspace project.

The relay is the authority. It may persist snapshots and event records with a server-only `SUPABASE_SERVICE_ROLE_KEY`. That key must never appear in Vite assets, Capacitor assets, browser storage, logs, or public GitHub history.

Provisioning is intentionally deferred until the owner confirms the organization and the creation cost. Once a dedicated project exists, apply the migration, inspect the RLS/security advisors, and add the project URL/key only through deployment secrets.
