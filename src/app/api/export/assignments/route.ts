import { createClient } from '@/lib/supabase/server'
import { buildSessionReportExcel } from '@/lib/export'
import { deriveSessionReport, type RawSessionRecord } from '@/lib/sessionReport'
import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_ROLES = ['admin', 'partner', 'manager']

type RawRow = {
  article_id:      string
  attendance_date: string
  checked_in_at:   string
  checked_out_at:  string | null
  assignment_id:   string
  profiles:        { full_name: string } | { full_name: string }[] | null
  assignments:     { client_name: string; work_type: string } | { client_name: string; work_type: string }[] | null
}

function extractName(profiles: RawRow['profiles']): string {
  if (Array.isArray(profiles)) return profiles[0]?.full_name ?? ''
  if (profiles) return profiles.full_name
  return ''
}

function extractAssignment(
  assignments: RawRow['assignments']
): { client_name: string; work_type: string } | null {
  if (Array.isArray(assignments)) return assignments[0] ?? null
  return assignments
}

// GET /api/export/assignments — Session Report
//
// ?assignment_id=<uuid>  optional — omit (or empty) for "All Assignments"
// ?format=json            optional — returns { rows: SessionReportRow[] }
//                          instead of an .xlsx file. Used by the in-app
//                          Preview modal so it renders EXACTLY the same data
//                          the Excel export produces — both paths call
//                          deriveSessionReport() against the same query.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status !== 'active' || !ALLOWED_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const assignmentId = searchParams.get('assignment_id') || null
  const wantsJson     = searchParams.get('format') === 'json'

  let assignmentClientName: string | null = null

  if (assignmentId) {
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select('id, client_name')
      .eq('id', assignmentId)
      .single()

    if (assignmentError || !assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })
    }
    assignmentClientName = assignment.client_name
  }

  // Single query, joined with assignments + profiles — no N+1 regardless of
  // whether this is scoped to one assignment or "All Assignments".
  // (Built via reassignment rather than a ternary of two full chains —
  // branching the chain itself blows up supabase-js's generic inference.)
  let recordsQuery = supabase
    .from('attendance_records')
    .select('article_id, attendance_date, checked_in_at, checked_out_at, assignment_id, profiles!article_id(full_name), assignments(client_name, work_type)')
    .not('checked_in_at', 'is', null)
    .not('assignment_id', 'is', null)
    .order('attendance_date', { ascending: true })

  if (assignmentId) {
    recordsQuery = recordsQuery.eq('assignment_id', assignmentId)
  }

  const { data: rawRecords, error: recordsError } = await recordsQuery
  if (recordsError) return NextResponse.json({ error: recordsError.message }, { status: 500 })

  const records: RawSessionRecord[] = ((rawRecords ?? []) as RawRow[])
    .map(r => {
      const asgn = extractAssignment(r.assignments)
      if (!asgn) return null
      return {
        article_id:      r.article_id,
        attendance_date: r.attendance_date,
        checked_in_at:   r.checked_in_at,
        checked_out_at:  r.checked_out_at,
        assignment_id:   r.assignment_id,
        article_name:    extractName(r.profiles),
        client_name:     asgn.client_name,
        work_type:       asgn.work_type,
      }
    })
    .filter((r): r is RawSessionRecord => r !== null)

  const todayIST    = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const sessionRows = deriveSessionReport(records, todayIST)

  if (wantsJson) {
    return NextResponse.json({ rows: sessionRows })
  }

  const buffer = await buildSessionReportExcel(sessionRows)
  const safeClient = assignmentClientName
    ? assignmentClientName.replace(/[^a-zA-Z0-9]+/g, '_')
    : 'all_assignments'
  const filename = `session_report_${safeClient}_${todayIST}.xlsx`

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
