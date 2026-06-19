import { createClient } from '@/lib/supabase/server'
import { buildAttendanceRegisterExcel } from '@/lib/export'
import type { AttendanceRegisterRow } from '@/lib/export'
import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_ROLES = ['admin', 'partner', 'manager']

function generateDateRange(start: string, end: string): string[] {
  const dates: string[] = []
  const [sy, sm, sd] = start.split('-').map(Number)
  const [ey, em, ed] = end.split('-').map(Number)
  const current = new Date(Date.UTC(sy, sm - 1, sd))
  const last    = new Date(Date.UTC(ey, em - 1, ed))
  while (current <= last) {
    dates.push(current.toISOString().slice(0, 10))
    current.setUTCDate(current.getUTCDate() + 1)
  }
  return dates
}

function fmtTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   true,
  })
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
  const startDate = searchParams.get('start_date')
  const endDate   = searchParams.get('end_date')

  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'start_date and end_date required' }, { status: 400 })
  }
  if (startDate > endDate) {
    return NextResponse.json({ error: 'start_date must be on or before end_date' }, { status: 400 })
  }

  const daySpan = Math.round(
    (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000
  )
  if (daySpan > 365) {
    return NextResponse.json({ error: 'Date range cannot exceed 365 days' }, { status: 400 })
  }

  // 1. Active articles sorted by name
  const { data: articles, error: articlesErr } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('role', 'article')
    .eq('status', 'active')
    .order('full_name')

  if (articlesErr) return NextResponse.json({ error: articlesErr.message }, { status: 500 })
  if (!articles || articles.length === 0) {
    const buffer = await buildAttendanceRegisterExcel([], startDate, endDate)
    return registerResponse(buffer, startDate, endDate)
  }

  const articleIds = articles.map(a => a.id)

  // 2. All attendance records in range (fetched in one query, sorted by check-in asc
  //    so the first session per day is already at the front)
  const { data: attendanceData, error: attErr } = await supabase
    .from('attendance_records')
    .select('article_id, attendance_date, checked_in_at, checked_out_at, attendance_type, others_client_name, assignments(client_name, work_type)')
    .gte('attendance_date', startDate)
    .lte('attendance_date', endDate)
    .in('article_id', articleIds)
    .not('checked_in_at', 'is', null)
    .order('checked_in_at', { ascending: true })

  if (attErr) return NextResponse.json({ error: attErr.message }, { status: 500 })

  // 3. All leave records in range
  const { data: leaveData, error: leaveErr } = await supabase
    .from('leave_records')
    .select('article_id, leave_date, leave_type')
    .gte('leave_date', startDate)
    .lte('leave_date', endDate)
    .in('article_id', articleIds)

  if (leaveErr) return NextResponse.json({ error: leaveErr.message }, { status: 500 })

  // Build lookup maps keyed by `article_id:date`
  type SessionShape = {
    article_id:         string
    attendance_date:    string
    checked_in_at:      string | null
    checked_out_at:     string | null
    attendance_type:    string
    others_client_name: string | null
    assignments:        { client_name: string; work_type: string } | { client_name: string; work_type: string }[] | null
  }

  const sessionsByKey = new Map<string, SessionShape[]>()
  for (const rec of (attendanceData ?? []) as SessionShape[]) {
    const key = `${rec.article_id}:${rec.attendance_date}`
    if (!sessionsByKey.has(key)) sessionsByKey.set(key, [])
    sessionsByKey.get(key)!.push(rec)
  }

  const leaveByKey = new Map<string, string>()
  for (const rec of leaveData ?? []) {
    leaveByKey.set(`${rec.article_id}:${rec.leave_date}`, rec.leave_type as string)
  }

  // Cross-join: every article × every date in range
  const dateRange = generateDateRange(startDate, endDate)
  const rows: AttendanceRegisterRow[] = []

  for (const date of dateRange) {
    for (const article of articles) {
      const key      = `${article.id}:${date}`
      const sessions = sessionsByKey.get(key) ?? []
      const leaveType = leaveByKey.get(key) ?? null

      const hasAttendance = sessions.length > 0

      // Derive status per spec
      let status: AttendanceRegisterRow['status']
      if (hasAttendance) {
        if (leaveType === 'first_half')  status = 'First Half Leave'
        else if (leaveType === 'second_half') status = 'Second Half Leave'
        else                             status = 'Present'
      } else {
        if (leaveType === 'full_day')    status = 'Full Day Leave'
        else if (leaveType === 'first_half')  status = 'First Half Leave'
        else if (leaveType === 'second_half') status = 'Second Half Leave'
        else                             status = 'AWOL'
      }

      // Aggregate sessions for display columns
      let checkIn   = ''
      let checkOut  = ''
      let duration  = ''
      let client    = ''
      let workType  = ''

      if (hasAttendance) {
        const first = sessions[0]
        const last  = sessions[sessions.length - 1]

        checkIn  = fmtTime(first.checked_in_at)
        checkOut = fmtTime(last.checked_out_at)

        let totalMins = 0
        for (const s of sessions) {
          if (s.checked_in_at && s.checked_out_at) {
            totalMins += Math.round(
              (new Date(s.checked_out_at).getTime() - new Date(s.checked_in_at).getTime()) / 60_000
            )
          }
        }
        if (totalMins > 0) {
          const h = Math.floor(totalMins / 60)
          const m = totalMins % 60
          duration = h > 0 ? `${h}h ${m}m` : `${m}m`
        }

        // Client from the first session of the day
        const asgn = Array.isArray(first.assignments) ? first.assignments[0] : first.assignments
        if (first.attendance_type === 'unallocated') {
          client = 'Unallocated'
        } else if (asgn?.client_name) {
          client   = asgn.client_name
          workType = asgn.work_type ?? ''
        } else {
          client   = first.others_client_name ?? 'Others'
          workType = 'Others'
        }
      }

      rows.push({ date, article_name: article.full_name, status, check_in: checkIn, check_out: checkOut, duration, client, work_type: workType })
    }
  }

  const buffer = await buildAttendanceRegisterExcel(rows, startDate, endDate)
  return registerResponse(buffer, startDate, endDate)
}

function registerResponse(buffer: Buffer, startDate: string, endDate: string): NextResponse {
  const filename = `attendance_register_${startDate}_to_${endDate}.xlsx`
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
