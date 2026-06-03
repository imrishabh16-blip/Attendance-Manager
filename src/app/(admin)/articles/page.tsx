import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import type { UserStatus } from '@/types/app'

function StatusBadge({ status }: { status: UserStatus }) {
  if (status === 'active')      return <Badge variant="success" className="text-xs">Active</Badge>
  if (status === 'deactivated') return <Badge variant="danger"  className="text-xs">Deactivated</Badge>
  return                               <Badge variant="warning" className="text-xs">Pending</Badge>
}

export default async function ArticlesPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', session.user.id)
    .single()

  if (!profile || profile.status !== 'active') {
    redirect(profile?.status === 'deactivated' ? '/deactivated' : '/awaiting')
  }
  if (profile.role === 'article') redirect('/attend')

  const { data: articles } = await supabase
    .from('profiles')
    .select('id, full_name, email, status')
    .eq('role', 'article')
    .order('full_name')

  const list = articles ?? []

  return (
    <div className="min-h-screen bg-brand-50">
      <div className="bg-white border-b border-gray-100 px-4 sm:px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-lg font-bold text-gray-900">Articles</h1>
          <p className="text-xs text-gray-400 mt-0.5">{list.length} article clerk{list.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5">
        <div className="grid gap-3">
          {list.length === 0 && (
            <p className="text-center py-12 text-sm text-gray-400">No article clerks found</p>
          )}
          {list.map(a => (
            <Card key={a.id}>
              <div className="px-5 py-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">{a.full_name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{a.email}</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <StatusBadge status={a.status as UserStatus} />
                  <Link
                    href={`/articles/${a.id}`}
                    className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                  >
                    View →
                  </Link>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
