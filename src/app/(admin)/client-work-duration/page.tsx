import { redirect } from 'next/navigation'
import { getViewer } from '@/lib/supabase/server'
import ClientWorkDurationClient from './ClientWorkDurationClient'
import { isArticleRole } from '@/types/app'

export default async function ClientWorkDurationPage() {
  const { user, profile } = await getViewer()
  if (!user) redirect('/login')

  if (!profile || profile.status !== 'active') redirect(profile?.status === 'deactivated' ? '/deactivated' : '/awaiting')
  if (isArticleRole(profile.role)) redirect('/attend')

  return <ClientWorkDurationClient />
}
