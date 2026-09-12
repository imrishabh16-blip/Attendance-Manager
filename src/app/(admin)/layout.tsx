import { redirect } from 'next/navigation'
import { getViewer } from '@/lib/supabase/server'
import AdminNav from '@/components/layout/AdminNav'
import { isArticleRole } from '@/types/app'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, profile } = await getViewer()
  if (!user) redirect('/login')

  if (!profile || profile.status !== 'active') redirect(profile?.status === 'deactivated' ? '/deactivated' : '/awaiting')
  if (isArticleRole(profile.role)) redirect('/attend')

  return (
    <div className="flex min-h-screen">
      <AdminNav profile={profile} />
      {/* min-w-0 prevents flex children from expanding past their allocation.
          overflow-x-hidden clips anything wider than the viewport.
          overflow-y-auto allows normal vertical page scroll.
          pb-20 sm:pb-0 clears the fixed mobile bottom nav (≈56px + safe area). */}
      <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden pb-20 sm:pb-0 pt-14 sm:pt-0">
        {children}
      </main>
    </div>
  )
}
