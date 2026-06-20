import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ReportsClient from './ReportsClient'

export default async function ReportsPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', session.user.id)
    .single()

  if (!profile || profile.status !== 'active') redirect(profile?.status === 'deactivated' ? '/deactivated' : '/awaiting')
  if (profile.role === 'article') redirect('/attend')

  const [{ data: articles }, { data: assignments }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('role', 'article')
      .eq('status', 'active')
      .order('full_name'),
    supabase
      .from('assignments')
      .select('id, client_name, work_type, status')
      .order('client_name'),
  ])

  return <ReportsClient articles={articles ?? []} assignments={assignments ?? []} />
}
