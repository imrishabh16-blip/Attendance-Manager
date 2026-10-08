import { createClient } from '@/lib/supabase/server'
import { buildClientWorkDurationExcel } from '@/lib/export'
import { deriveClientWorkDuration, type ClientWorkSlot } from '@/lib/workDuration'
import { fetchAllPages, toSessionRecords, SESSION_RECORD_SELECT, type RawAttendanceRow } from '@/lib/attendanceRecords'
import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_ROLES = ['admin', 'partner', 'manager']

// GET /api/export/client-work-duration?client_name=<name> — Client Analytics
//
// ?client_name=<name>  the selected client; the database does the filtering.
//                      Required unless export=all_clients.
// ?export=all_clients  EXPORT-ONLY: an .xlsx of every client. ONE query stream
//                      — the same paginated query without the client filter —
//                      aggregated by the same deriveClientWorkDuration(),
//                      which already groups by client, so each client's rows
//                      are identical to what its own client_name request
//                      returns. Only the .xlsx leaves the server: combining
//                      it with format=json or client_name is rejected (400),
//                      so the all-client dataset is never available as JSON.
// ?format=json         optional, client_name only — returns
//                      { rows: ClientWorkSlot[] } instead of an .xlsx file.
//                      Used by the Client Analytics page so it renders
//                      EXACTLY the same data the Excel export produces — both
//                      paths call deriveClientWorkDuration() against the same
//                      query result, so the two views can never diverge.
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
  const clientName  = searchParams.get('client_name')
  const exportParam = searchParams.get('export')
  const wantsJson   = searchParams.get('format') === 'json'
  const allClients  = exportParam === 'all_clients'

  if (exportParam !== null && !allClients) {
    return NextResponse.json({ error: 'Unsupported export' }, { status: 400 })
  }
  if (allClients && wantsJson) {
    return NextResponse.json({ error: 'All-client analytics is available as an Excel export only' }, { status: 400 })
  }
  if (allClients && clientName) {
    return NextResponse.json({ error: 'client_name cannot be combined with export=all_clients' }, { status: 400 })
  }
  if (!allClients && !clientName) {
    return NextResponse.json({ error: 'client_name is required' }, { status: 400 })
  }

  // Assignments store the client as free text, so the name is the join key
  // into attendance. Filtered in the database via the !inner assignments
  // join (which also drops Others/unallocated punches), then paginated —
  // joined with profiles, so no N+1. .order('id') is a deterministic
  // tiebreaker for attendance_date, required for stable offset pagination. A
  // name with no attendance simply yields no rows. With export=all_clients
  // the client filter is simply omitted: the same query, over every client.
  const { data: rawRecords, error: recordsError } = await fetchAllPages<RawAttendanceRow>((from, to) => {
    const base = supabase
      .from('attendance_records')
      .select(SESSION_RECORD_SELECT)

    return (clientName ? base.eq('assignments.client_name', clientName) : base)
      .not('checked_in_at', 'is', null)
      .order('attendance_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  })
  if (recordsError) return NextResponse.json({ error: recordsError.message }, { status: 500 })

  const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const rows: ClientWorkSlot[] = deriveClientWorkDuration(toSessionRecords(rawRecords), todayIST)

  // Individual client only — export=all_clients + format=json was rejected above.
  if (wantsJson) {
    return NextResponse.json({ rows })
  }

  const buffer = await buildClientWorkDurationExcel(rows)
  const safeClient = (clientName ?? 'All Clients').replace(/[^a-zA-Z0-9]+/g, '_')
  const filename = `client_analytics_${safeClient}_${todayIST}.xlsx`

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
