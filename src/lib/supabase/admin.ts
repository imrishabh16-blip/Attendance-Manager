import { createClient } from '@supabase/supabase-js'

// Service-role client — bypasses RLS.
// ONLY import this in API route handlers (server-side).
// NEVER import in client components or pages.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
