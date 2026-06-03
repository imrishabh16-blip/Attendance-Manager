import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminNav from '@/components/layout/AdminNav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, role, status')
    .eq('id', session.user.id)
    .single()

  if (!profile || profile.status !== 'active') redirect(profile?.status === 'deactivated' ? '/deactivated' : '/awaiting')
  if (profile.role === 'article') redirect('/attend')

  return (
    <div className="flex min-h-screen">
      <AdminNav profile={profile} />
      {/* min-w-0 prevents flex children from expanding past their allocation.
          overflow-x-hidden clips anything wider than the viewport.
          overflow-y-auto allows normal vertical page scroll.
          pb-20 sm:pb-0 clears the fixed mobile bottom nav (≈56px + safe area). */}
      <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden pb-20 sm:pb-0">
        {children}
      </main>
    </div>
  )
}
