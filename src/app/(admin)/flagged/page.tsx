import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import FlaggedClient from './FlaggedClient'
import type { FlaggedRecord } from '@/types/app'

const ELEVATED = ['admin', 'partner', 'manager']

export default async function FlaggedPage() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', session.user.id)
    .single()

  if (!profile || profile.status !== 'active') redirect('/awaiting')
  if (!ELEVATED.includes(profile.role)) redirect('/dashboard')

  const { data: records } = await supabase.rpc('get_flagged_records')

  return <FlaggedClient records={(records ?? []) as FlaggedRecord[]} />
}
