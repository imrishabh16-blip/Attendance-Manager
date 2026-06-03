import { createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/awaiting', '/deactivated']
const API_PUBLIC   = ['/api/auth']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const isPublicPage = PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
  const isPublicApi  = API_PUBLIC.some(p => pathname.startsWith(p))
  if (isPublicPage || isPublicApi) return NextResponse.next()

  // Static assets — skip
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/manifest')
  ) return NextResponse.next()

  let response = NextResponse.next({
    request: { headers: request.headers },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request: { headers: request.headers } })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2])
          )
        },
      },
    }
  )

  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', session.user.id)
    .single()

  if (!profile || profile.status === 'pending') {
    return NextResponse.redirect(new URL('/awaiting', request.url))
  }
  if (profile.status === 'deactivated') {
    return NextResponse.redirect(new URL('/deactivated', request.url))
  }

  const { role } = profile

  // Article routing: can only access /attend
  if (role === 'article') {
    if (!pathname.startsWith('/attend') && !pathname.startsWith('/api/attendance') && !pathname.startsWith('/api/leave')) {
      return NextResponse.redirect(new URL('/attend', request.url))
    }
    return response
  }

  // Manager cannot access user management
  if (role === 'manager' && pathname.startsWith('/users')) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // Non-admin cannot delete/permanently remove — enforced at API level too
  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.png|.*\\.svg).*)',
  ],
}
