function envValue(name) {
  return String(process.env[name] ?? '').trim();
}

export function supabaseUrl() {
  return envValue('SUPABASE_URL').replace(/\/+$/, '');
}

/**
 * Prefer Supabase's current server-only secret key name while retaining the
 * legacy service-role name for existing deployments during the transition.
 */
export function supabaseServerKey() {
  return envValue('SUPABASE_SECRET_KEY') || envValue('SUPABASE_SERVICE_ROLE_KEY');
}

export function supabaseConfigured() {
  return Boolean(supabaseUrl() && supabaseServerKey());
}

