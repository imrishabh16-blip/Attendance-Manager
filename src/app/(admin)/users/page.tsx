import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import UsersClient from './UsersClient'
import type { UserRole } from '@/types/app'

export default async function UsersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status !== 'active') redirect('/awaiting')
  // Admins: full access. Partners: read + edit roles only (no approve/deactivate/reactivate).
  if (profile.role !== 'admin' && profile.role !== 'partner') redirect('/dashboard')

  const { data: users } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })

  return (
    <UsersClient
      users={users ?? []}
      currentUserId={user.id}
      currentUserRole={profile.role as UserRole}
    />
  )
}
