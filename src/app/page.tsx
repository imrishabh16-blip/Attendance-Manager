import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Root page: redirect based on session + role
export default async function RootPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', session.user.id)
    .single()

  if (!profile || profile.status === 'pending') redirect('/awaiting')
  if (profile.status === 'deactivated') redirect('/deactivated')
  if (profile.role === 'article') redirect('/attend')
  redirect('/dashboard')
}
