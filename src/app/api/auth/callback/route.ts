import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code  = searchParams.get('code')
  const error = searchParams.get('error')

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${error}`)
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login`)
  }

  const supabase = await createClient()
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

  if (exchangeError) {
    // flow_state_already_used: the PKCE code was already consumed — most commonly
    // triggered by the browser back button after a successful login. The session
    // cookie is already set from the first exchange, so check for it and route
    // normally rather than sending the user back to login with a confusing error.
    const { data: { session: existing } } = await supabase.auth.getSession()
    if (!existing) {
      return NextResponse.redirect(`${origin}/login?error=auth_failed`)
    }
    // Session exists — fall through and route based on profile below.
  }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    return NextResponse.redirect(`${origin}/login`)
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', session.user.id)
    .single()

  if (!profile || profile.status === 'pending') {
    return NextResponse.redirect(`${origin}/awaiting`)
  }
  if (profile.status === 'deactivated') {
    return NextResponse.redirect(`${origin}/deactivated`)
  }
  if (profile.role === 'article') {
    return NextResponse.redirect(`${origin}/attend`)
  }
  return NextResponse.redirect(`${origin}/dashboard`)
}
