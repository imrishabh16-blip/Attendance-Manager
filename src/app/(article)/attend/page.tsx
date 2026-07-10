import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AttendClient from './AttendClient'
import { isArticleRole } from '@/types/app'

export default async function AttendPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, role, status')
    .eq('id', session.user.id)
    .single()

  if (!profile || profile.status !== 'active') redirect(profile?.status === 'deactivated' ? '/deactivated' : '/awaiting')
  if (!isArticleRole(profile.role)) redirect('/dashboard')

  return <AttendClient profile={profile} />
}
