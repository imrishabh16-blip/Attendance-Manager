import { createClient } from '@/lib/supabase/server'
import { buildSessionReportExcel } from '@/lib/export'
import type { SessionReportRow } from '@/lib/export'
import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_ROLES = ['admin', 'partner', 'manager']

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000
}

type RawRecord = {
  article_id:      string
  attendance_date: string
  checked_in_at:   string
  checked_out_at:  string | null
  profiles:        { full_name: string } | { full_name: string }[] | null
}

function extractName(profiles: RawRecord['profiles']): string {
  if (Array.isArray(profiles)) return profiles[0]?.full_name ?? ''
  if (profiles) return profiles.full_name
  return ''
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', session.user.id)
    .single()

  if (!profile || profile.status !== 'active' || !ALLOWED_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const assignmentId = searchParams.get('assignment_id')
  if (!assignmentId) return NextResponse.json({ error: 'assignment_id required' }, { status: 400 })

  const { data: assignment, error: assignmentError } = await supabase
    .from('assignments')
    .select('id, client_name, work_type')
    .eq('id', assignmentId)
    .single()

  if (assignmentError || !assignment) {
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })
  }

  const { data: rawRecords, error: recordsError } = await supabase
    .from('attendance_records')
    .select('article_id, attendance_date, checked_in_at, checked_out_at, profiles!article_id(full_name)')
    .eq('assignment_id', assignmentId)
    .not('checked_in_at', 'is', null)
    .order('attendance_date', { ascending: true })

  if (recordsError) return NextResponse.json({ error: recordsError.message }, { status: 500 })

  const records     = (rawRecords ?? []) as RawRecord[]
  const todayIST    = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const assignLabel = `${assignment.client_name} — ${assignment.work_type}`
  const safeClient  = assignment.client_name.replace(/[^a-zA-Z0-9]+/g, '_')
  const filename    = `session_report_${safeClient}_${todayIST}.xlsx`

  if (records.length === 0) {
    const buffer = await buildSessionReportExcel([])
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  }

  // Derive sessions from distinct attendance dates using 7-day gap rule
  const dateSet     = new Set(records.map(r => r.attendance_date))
  const sortedDates = [...dateSet].sort()

  const sessions: string[][] = []
  let current = [sortedDates[0]]

  for (let i = 1; i < sortedDates.length; i++) {
    if (daysBetween(sortedDates[i - 1], sortedDates[i]) > 7) {
      sessions.push(current)
      current = [sortedDates[i]]
    } else {
      current.push(sortedDates[i])
    }
  }
  sessions.push(current)

  // Aggregate per session
  const sessionRows: SessionReportRow[] = sessions.map((sessionDates, idx) => {
    const sessionDateSet = new Set(sessionDates)
    const sessionRecords = records.filter(r => sessionDateSet.has(r.attendance_date))

    const articleMap = new Map<string, string>()
    let totalHours = 0

    for (const r of sessionRecords) {
      if (!articleMap.has(r.article_id)) {
        articleMap.set(r.article_id, extractName(r.profiles))
      }
      if (r.checked_out_at) {
        totalHours +=
          (new Date(r.checked_out_at).getTime() - new Date(r.checked_in_at).getTime()) /
          3_600_000
      }
    }

    const articleNames = [...articleMap.values()].filter(Boolean).sort()
    const firstDate    = sessionDates[0]
    const lastDate     = sessionDates[sessionDates.length - 1]
    const status: 'Active' | 'Completed' =
      daysBetween(lastDate, todayIST) <= 7 ? 'Active' : 'Completed'

    return {
      assignment_label: assignLabel,
      client_name:      assignment.client_name,
      work_type:        assignment.work_type,
      session_number:   `S${idx + 1}`,
      articles_count:   articleMap.size,
      article_names:    articleNames.join(', '),
      attendance_days:  sessionDates.length,
      total_hours:      Math.round(totalHours * 10) / 10,
      status,
      first_date:       firstDate,
      last_date:        lastDate,
    }
  })

  const buffer = await buildSessionReportExcel(sessionRows)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
