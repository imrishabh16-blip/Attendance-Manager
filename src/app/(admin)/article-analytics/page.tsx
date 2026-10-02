import { redirect } from 'next/navigation'
import { getViewer } from '@/lib/supabase/server'
import ArticleAnalyticsClient from './ArticleAnalyticsClient'
import { ARTICLE_ROLES, isArticleRole } from '@/types/app'

export default async function ArticleAnalyticsPage() {
  const { supabase, user, profile } = await getViewer()
  if (!user) redirect('/login')

  if (!profile || profile.status !== 'active') redirect(profile?.status === 'deactivated' ? '/deactivated' : '/awaiting')
  if (isArticleRole(profile.role)) redirect('/attend')

  // Selector list only — names, no attendance. Deactivated articles are
  // included so their history stays reportable; pending ones have none.
  // Performance data is fetched per article, after the user picks one.
  const { data: articles } = await supabase
    .from('profiles')
    .select('id, full_name, status')
    .in('role', ARTICLE_ROLES)
    .in('status', ['active', 'deactivated'])
    .order('full_name')

  return <ArticleAnalyticsClient articles={articles ?? []} />
}
