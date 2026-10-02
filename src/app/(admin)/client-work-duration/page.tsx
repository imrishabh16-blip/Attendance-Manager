import { redirect } from 'next/navigation'
import { getViewer } from '@/lib/supabase/server'
import ClientWorkDurationClient from './ClientWorkDurationClient'
import { isArticleRole } from '@/types/app'

export default async function ClientWorkDurationPage() {
  const { supabase, user, profile } = await getViewer()
  if (!user) redirect('/login')

  if (!profile || profile.status !== 'active') redirect(profile?.status === 'deactivated' ? '/deactivated' : '/awaiting')
  if (isArticleRole(profile.role)) redirect('/attend')

  // Selector list only — no attendance is read here. Distinct client names come
  // from assignments (one small row per client + work type), not the clients
  // master: assignments are never deleted and attendance references them with
  // on delete restrict, so every client with history stays reportable even if
  // it was later removed from the master. Per-client work duration is fetched
  // only after the user picks one.
  const { data: assignments } = await supabase
    .from('assignments')
    .select('client_name')

  const clients = [...new Set((assignments ?? []).map(a => a.client_name as string))]
    .sort((a, b) => a.localeCompare(b))

  return <ClientWorkDurationClient clients={clients} />
}
