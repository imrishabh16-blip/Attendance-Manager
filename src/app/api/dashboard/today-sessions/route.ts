import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { AttendanceType } from '@/types/app'

export interface TodaySessionItem {
  id:              string
  article_name:    string
  checked_in_at:   string
  checked_out_at:  string | null
  attendance_type: AttendanceType
  client_label:    string
  work_type:       string | null
}

export async function GET() {
  const supabase = await createClient()

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: viewer } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', session.user.id)
    .single()

  if (!viewer || viewer.status !== 'active' || viewer.role === 'article') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

  // Fetch attendance records with assignment join (server-side — RLS allows admin reads)
  const { data: records, error } = await supabase
    .from('attendance_records')
    .select('id, article_id, checked_in_at, checked_out_at, attendance_type, others_client_name, assignments(client_name, work_type)')
    .eq('attendance_date', today)
    .not('checked_in_at', 'is', null)
    .order('checked_in_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!records?.length) return NextResponse.json({ data: [] })

  // Resolve article names in a single profiles query
  const articleIds = [...new Set(records.map(r => r.article_id))]
  const { data: profileRows } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', articleIds)

  const nameMap: Record<string, string> = Object.fromEntries(
    (profileRows ?? []).map(p => [p.id, p.full_name as string])
  )

  const data: TodaySessionItem[] = records.map(r => {
    const asgn = r.assignments as unknown as { client_name: string; work_type: string } | null

    let client_label: string
    if (r.attendance_type === 'unallocated')    client_label = 'Unallocated'
    else if (r.attendance_type === 'others')    client_label = r.others_client_name ?? 'Others'
    else if (asgn?.client_name)                 client_label = asgn.client_name
    else                                        client_label = '—'

    return {
      id:              r.id,
      article_name:    nameMap[r.article_id] ?? '—',
      checked_in_at:   r.checked_in_at as string,
      checked_out_at:  r.checked_out_at as string | null,
      attendance_type: r.attendance_type as AttendanceType,
      client_label,
      work_type:       (r.attendance_type === 'regular' && asgn) ? asgn.work_type : null,
    }
  })

  return NextResponse.json({ data })
}
