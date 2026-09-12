import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DashboardClient from './DashboardClient'
import { isArticleRole } from '@/types/app'
import type { DashboardSummary, LiveActivityRow, OnLeaveArticleRow } from '@/types/app'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, role, status')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status !== 'active') redirect(profile?.status === 'deactivated' ? '/deactivated' : '/awaiting')
  if (isArticleRole(profile.role)) redirect('/attend')

  const [summaryRes, liveRes, onLeaveRes, awolRes] = await Promise.all([
    supabase.rpc('get_dashboard_summary'),
    supabase.rpc('get_live_activity'),
    supabase.rpc('get_on_leave_articles'),
    supabase.rpc('get_awol_articles'),
  ])

  return (
    <DashboardClient
      profile={profile}
      initialData={{
        summary:         (summaryRes.data ?? null) as DashboardSummary | null,
        liveActivity:    (liveRes.data ?? [])      as LiveActivityRow[],
        onLeaveArticles: (onLeaveRes.data ?? [])   as OnLeaveArticleRow[],
        awolArticles:    (awolRes.data ?? [])      as OnLeaveArticleRow[],
      }}
    />
  )
}
