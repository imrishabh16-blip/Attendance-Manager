import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AssignmentsClient from './AssignmentsClient'

export default async function AssignmentsPage() {
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

  const [{ data: assignments }, { data: clients }, { data: workTypesData }] = await Promise.all([
    supabase.from('assignments').select('*').order('client_name'),
    supabase.from('clients').select('*').order('name'),
    supabase.from('work_types').select('id, name').order('name'),
  ])

  return (
    <AssignmentsClient
      assignments={assignments ?? []}
      clients={clients ?? []}
      workTypes={(workTypesData ?? []).map((r: { id: string; name: string }) => ({ id: r.id, name: r.name }))}
      role={profile.role}
    />
  )
}
