import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Polled by the /awaiting page every 8 seconds
export async function GET() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    return NextResponse.json({ status: 'unauthenticated' })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('status, role')
    .eq('id', session.user.id)
    .single()

  if (!profile) {
    return NextResponse.json({ status: 'pending' })
  }

  return NextResponse.json({ status: profile.status, role: profile.role })
}
