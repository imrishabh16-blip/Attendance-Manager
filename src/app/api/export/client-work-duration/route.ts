import { createClient } from '@/lib/supabase/server'
import { buildClientWorkDurationExcel } from '@/lib/export'
import { deriveClientWorkDuration, type ClientWorkSlot } from '@/lib/workDuration'
import { fetchAllPages, toSessionRecords, SESSION_RECORD_SELECT, type RawAttendanceRow } from '@/lib/attendanceRecords'
import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_ROLES = ['admin', 'partner', 'manager']

// GET /api/export/client-work-duration?client_name=<name> — Client Work Duration
//
// ?client_name=<name>  required — the selected client. The report is always
//                      scoped to one client and the database does the
//                      filtering; there is deliberately no "all clients"
//                      mode, so this route never reads the full attendance
//                      history.
// ?format=json         optional — returns { rows: ClientWorkSlot[] } instead of
//                      an .xlsx file. Used by the Client Work Duration page so
//                      it renders EXACTLY the same data the Excel export
//                      produces — both paths call deriveClientWorkDuration()
//                      against the same query result, so the two views can
//                      never diverge.
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
  const clientName = searchParams.get('client_name')
  const wantsJson  = searchParams.get('format') === 'json'

  if (!clientName) {
    return NextResponse.json({ error: 'client_name is required' }, { status: 400 })
  }

  // Assignments store the client as free text, so the name is the join key
  // into attendance. Filtered in the database via the !inner assignments
  // join, then paginated — joined with profiles, so no N+1. .order('id') is a
  // deterministic tiebreaker for attendance_date, required for stable offset
  // pagination. A name with no attendance simply yields no rows.
  const { data: rawRecords, error: recordsError } = await fetchAllPages<RawAttendanceRow>((from, to) =>
    supabase
      .from('attendance_records')
      .select(SESSION_RECORD_SELECT)
      .eq('assignments.client_name', clientName)
      .not('checked_in_at', 'is', null)
      .order('attendance_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  )
  if (recordsError) return NextResponse.json({ error: recordsError.message }, { status: 500 })

  const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const rows: ClientWorkSlot[] = deriveClientWorkDuration(toSessionRecords(rawRecords), todayIST)

  if (wantsJson) {
    return NextResponse.json({ rows })
  }

  const buffer = await buildClientWorkDurationExcel(rows)
  const safeClient = clientName.replace(/[^a-zA-Z0-9]+/g, '_')
  const filename = `client_work_duration_${safeClient}_${todayIST}.xlsx`

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
