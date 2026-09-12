import { redirect } from 'next/navigation'
import { getViewer } from '@/lib/supabase/server'
import AssignmentsClient from './AssignmentsClient'
import { isArticleRole } from '@/types/app'

export default async function AssignmentsPage() {
  const { supabase, user, profile } = await getViewer()
  if (!user) redirect('/login')

  if (!profile || profile.status !== 'active') redirect(profile?.status === 'deactivated' ? '/deactivated' : '/awaiting')
  if (isArticleRole(profile.role)) redirect('/attend')

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
