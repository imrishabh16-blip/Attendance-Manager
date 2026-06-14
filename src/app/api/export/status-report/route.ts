import { createClient } from '@/lib/supabase/server'
import { buildStatusReportExcel, type StatusReportRow } from '@/lib/export'
import { NextResponse } from 'next/server'

const ALLOWED_ROLES = ['admin', 'partner', 'manager']

type AttendanceRow = {
  id:                  string
  article_id:          string
  checked_in_at:       string | null
  checked_out_at:      string | null
  attendance_type:     string
  others_client_name:  string | null
  assignments:         unknown
}

function resolveClient(
  type: string,
  othersName: string | null,
  asgn: { client_name: string } | null,
): string {
  if (type === 'unallocated') return 'Unallocated'
  if (type === 'others')      return othersName ?? 'Others'
  return asgn?.client_name ?? '—'
}

function fmtIST(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   true,
  })
}

function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
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

  if (!viewer || viewer.status !== 'active' || !ALLOWED_ROLES.includes(viewer.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

  const [articlesRes, recordsRes, leavesRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('role', 'article')
      .eq('status', 'active')
      .order('full_name'),

    supabase
      .from('attendance_records')
      .select('id, article_id, checked_in_at, checked_out_at, attendance_type, others_client_name, assignments(client_name, work_type)')
      .eq('attendance_date', today)
      .not('checked_in_at', 'is', null)
      .order('checked_in_at', { ascending: false }),

    supabase
      .from('leave_records')
      .select('article_id')
      .eq('leave_date', today),
  ])

  if (articlesRes.error) return NextResponse.json({ error: articlesRes.error.message }, { status: 500 })
  if (recordsRes.error)  return NextResponse.json({ error: recordsRes.error.message  }, { status: 500 })
  if (leavesRes.error)   return NextResponse.json({ error: leavesRes.error.message   }, { status: 500 })

  const articles  = articlesRes.data ?? []
  const records   = (recordsRes.data ?? []) as AttendanceRow[]
  const leaveSet  = new Set((leavesRes.data ?? []).map(l => l.article_id))

  // Group attendance records by article (records are ordered desc by checked_in_at)
  const byArticle = new Map<string, AttendanceRow[]>()
  for (const r of records) {
    const list = byArticle.get(r.article_id) ?? []
    list.push(r)
    byArticle.set(r.article_id, list)
  }

  const now = Date.now()
  const rows: StatusReportRow[] = []

  for (const article of articles) {
    const artRecords     = byArticle.get(article.id) ?? []
    const openSession    = artRecords.find(r => !r.checked_out_at)
    const closedSession  = artRecords.find(r => !!r.checked_out_at)

    let status:    StatusReportRow['status']
    let client   = ''
    let work_type = ''
    let check_in  = ''
    let check_out = ''
    let duration  = ''

    if (openSession) {
      const asgn = openSession.assignments as { client_name: string; work_type: string } | null
      status    = 'Checked In'
      client    = resolveClient(openSession.attendance_type, openSession.others_client_name, asgn)
      work_type = openSession.attendance_type === 'regular' && asgn ? asgn.work_type : ''
      check_in  = fmtIST(openSession.checked_in_at)
      const mins = Math.floor((now - new Date(openSession.checked_in_at!).getTime()) / 60000)
      duration  = fmtDuration(Math.max(0, mins))
    } else if (closedSession) {
      const asgn = closedSession.assignments as { client_name: string; work_type: string } | null
      status    = 'Completed'
      client    = resolveClient(closedSession.attendance_type, closedSession.others_client_name, asgn)
      work_type = closedSession.attendance_type === 'regular' && asgn ? asgn.work_type : ''
      check_in  = fmtIST(closedSession.checked_in_at)
      check_out = fmtIST(closedSession.checked_out_at)
      const mins = Math.floor(
        (new Date(closedSession.checked_out_at!).getTime() - new Date(closedSession.checked_in_at!).getTime()) / 60000
      )
      duration  = fmtDuration(Math.max(0, mins))
    } else if (leaveSet.has(article.id)) {
      status = 'On Leave'
    } else {
      status = 'AWOL'
    }

    rows.push({ article_name: article.full_name, status, client, work_type, check_in, check_out, duration })
  }

  const ORDER: Record<StatusReportRow['status'], number> = {
    'Checked In': 0,
    'Completed':  1,
    'On Leave':   2,
    'AWOL':       3,
  }
  rows.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.article_name.localeCompare(b.article_name))

  const buffer   = await buildStatusReportExcel(rows, today)
  const filename = `Status-Report-${today}.xlsx`

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
