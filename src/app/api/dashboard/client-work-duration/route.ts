import { createClient } from '@/lib/supabase/server'
import { deriveClientWorkDuration, type RawSessionRecord, type ClientWorkSlot } from '@/lib/sessionReport'
import { NextResponse } from 'next/server'
import { isArticleRole } from '@/types/app'
import type { PostgrestError } from '@supabase/supabase-js'

// Supabase/PostgREST caps any single response at this many rows — this
// query has no date bound (full attendance history), so it must page
// through the complete result. Same pattern as api/export/assignments.
const PAGE_SIZE = 1000

async function fetchAllPages<T>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>
): Promise<{ data: T[]; error: PostgrestError | null }> {
  const rows: T[] = []
  let from = 0
  while (true) {
    const { data, error } = await buildPage(from, from + PAGE_SIZE - 1)
    if (error) return { data: rows, error }
    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) return { data: rows, error: null }
    from += PAGE_SIZE
  }
}

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

// GET /api/dashboard/client-work-duration — Client Work Duration tile
//
// Historical data (full attendance history, same query shape as the Session
// Report's /api/export/assignments) — intentionally NOT part of the
// Dashboard's realtime RPC bundle (useRealtimeDashboard). The Dashboard
// fetches this only when the tile's modal is opened, same as
// /api/dashboard/today-sessions.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: viewer } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single()

  if (!viewer || viewer.status !== 'active' || isArticleRole(viewer.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Paginated, joined with assignments + profiles — no N+1. No date bound
  // (Client Work Duration always covers full history). .order('id') is a
  // deterministic tiebreaker for attendance_date, required for stable
  // offset pagination.
  const { data: rawRecords, error: recordsError } = await fetchAllPages<RawRow>((from, to) =>
    supabase
      .from('attendance_records')
      .select('article_id, attendance_date, checked_in_at, checked_out_at, assignment_id, profiles!article_id(full_name), assignments(client_name, work_type)')
      .not('checked_in_at', 'is', null)
      .not('assignment_id', 'is', null)
      .order('attendance_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  )
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

  const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const rows: ClientWorkSlot[] = deriveClientWorkDuration(records, todayIST)

  return NextResponse.json({ rows })
}
