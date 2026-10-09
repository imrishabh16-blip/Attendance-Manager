// Runtime replacement for src/lib/supabase/admin.ts under `npm test` (see
// alias-loader.mjs). Routes that use the service-role client call
// createAdminClient(); tests install the fake it should receive with
// setAdminSupabase().
let current: unknown = null

export function setAdminSupabase(client: unknown) {
  current = client
}

export function createAdminClient() {
  return current
}
