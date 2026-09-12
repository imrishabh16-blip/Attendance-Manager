import { createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { cache } from 'react'

// Next.js 15: cookies() is async — must await before calling getAll/set
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2])
            )
          } catch {
            // Ignored when called from a Server Component — can only set cookies
            // in middleware or route handlers.
          }
        },
      },
    }
  )
}

// Request-scoped: the admin layout and every admin page independently ran
// auth.getUser() + the same profiles lookup, each paying its own round trip.
// cache() (React's per-render memoization) makes every caller within one
// request share a single in-flight lookup instead. Does not — and cannot —
// cover middleware's own check: middleware runs before this render starts,
// in a separate execution context that cache() has no visibility into.
export const getViewer = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, user: null, profile: null }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, role, status')
    .eq('id', user.id)
    .single()

  return { supabase, user, profile }
})
