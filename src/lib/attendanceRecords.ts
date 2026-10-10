import type { PostgrestError } from '@supabase/supabase-js'
import type { RawSessionRecord } from '@/lib/workDuration'

// Supabase/PostgREST caps any single response at this many rows, so a query
// that can match more must page through its result.
const PAGE_SIZE = 1000

export async function fetchAllPages<T>(
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

// Select list shared by every query that feeds RawSessionRecord. The
// assignments join is !inner, so records with no assignment (Others /
// unallocated punches, which carry no validated client identity) are dropped
// by the database rather than filtered afterwards.
export const SESSION_RECORD_SELECT =
  'article_id, attendance_date, checked_in_at, checked_out_at, profiles!article_id(full_name), assignments!inner(client_name, work_type)'

export type RawAttendanceRow = {
  article_id:      string
  attendance_date: string
  checked_in_at:   string
  checked_out_at:  string | null
  profiles:        { full_name: string } | { full_name: string }[] | null
  assignments:     { client_name: string; work_type?: string | null } | { client_name: string; work_type?: string | null }[] | null
}

function first<T>(embedded: T | T[] | null): T | null {
  return Array.isArray(embedded) ? (embedded[0] ?? null) : embedded
}

export function toSessionRecords(rows: RawAttendanceRow[]): RawSessionRecord[] {
  return rows.flatMap(r => {
    const assignment = first(r.assignments)
    if (!assignment) return []
    return [{
      article_id:      r.article_id,
      attendance_date: r.attendance_date,
      checked_in_at:   r.checked_in_at,
      checked_out_at:  r.checked_out_at,
      article_name:    first(r.profiles)?.full_name ?? '',
      client_name:     assignment.client_name,
      work_type:       assignment.work_type ?? null,
    }]
  })
}
