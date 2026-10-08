// Runtime replacement for src/lib/supabase/server.ts under `npm test` (see
// alias-loader.mjs). The route under test calls createClient(); tests install
// the fake client it should receive with setSupabase().
let current: unknown = null

export function setSupabase(client: unknown) {
  current = client
}

export async function createClient() {
  return current
}
